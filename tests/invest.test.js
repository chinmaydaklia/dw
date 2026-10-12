import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fifo, classify, saleLines, capitalGains, valueAsset, depositState, fdAccrued, tradingSummary } from '../js/core/invest.js';
import { termOf, rulesFor } from '../js/core/taxrules.js';

const buy = (id, date, qty, cost, extra = {}) => ({ id, date, createdAt: date, meta: { inv: { assetId: 'a', action: 'buy', qty, cost, ...extra } }, lines: [] });
const sell = (id, date, qty, proceeds) => ({ id, date, createdAt: date, meta: { inv: { assetId: 'a', action: 'sell', qty, proceeds } }, lines: [] });

test('holding period: more than 12 months for equity, 24 for gold, debt funds after Apr 2023 always short', () => {
  const r = rulesFor('2026-27');
  assert.equal(termOf('equity', r, '2025-04-10', '2026-04-10'), 'short');
  assert.equal(termOf('equity', r, '2025-04-10', '2026-04-11'), 'long');
  assert.equal(termOf('other24', r, '2024-05-01', '2026-04-30'), 'short');
  assert.equal(termOf('other24', r, '2024-05-01', '2026-05-02'), 'long');
  assert.equal(termOf('debt_mf', r, '2023-06-01', '2026-06-01'), 'short');
  assert.equal(termOf('debt_mf', r, '2021-06-01', '2026-06-01'), 'long');
  assert.equal(termOf('vda', r, '2020-01-01', '2026-06-01'), 'flat');
});

test('FIFO: partial lots, proportional cost, exact paise, remainder to last slice', () => {
  const a = { id: 'a', type: 'equity' };
  const vs = [buy('b1', '2024-01-10', 10, 100000), buy('b2', '2025-09-01', 10, 150000), sell('s1', '2026-04-15', 15, 300001)];
  const f = fifo(a, vs);
  assert.equal(f.qty, 5); assert.equal(f.cost, 75000);
  assert.equal(f.realised.length, 2);
  assert.equal(f.realised[0].cost, 100000); assert.equal(f.realised[1].cost, 75000);
  assert.equal(f.realised[0].proceeds + f.realised[1].proceeds, 300001);
  const c = f.realised.map(s => classify(a, s));
  assert.equal(c[0].term, 'long'); assert.equal(c[1].term, 'short');
  assert.equal(c[0].ledgerKey, 'gain_eq_lt'); assert.equal(c[1].ledgerKey, 'gain_eq_st');
});

test('splits and bonuses; overselling is reported', () => {
  const a = { id: 'a', type: 'equity', events: [{ id: 'e1', date: '2025-01-01', type: 'split', ratio: 5 }, { id: 'e2', date: '2025-06-01', type: 'bonus', ratio: 1 }] };
  const f = fifo(a, [buy('b1', '2024-01-10', 10, 100000)]);
  assert.equal(f.qty, 100); assert.equal(f.cost, 100000);
  assert.equal(f.lots[1].cost, 0); assert.equal(f.lots[1].date, '2025-06-01');
  const g = fifo({ id: 'a', type: 'equity' }, [buy('b1', '2024-01-10', 1, 100), sell('s', '2025-01-01', 2, 500)]);
  assert.equal(g.problems.length, 1);
});

test('grandfathering for equity bought before 1 Feb 2018', () => {
  const a = { id: 'a', type: 'equity', openingLots: [{ id: 'o', date: '2017-05-01', qty: 10, cost: 50000, fmv2018: 90000 }] };
  const f = fifo(a, [sell('s', '2026-05-01', 10, 120000)]);
  const c = classify(a, f.realised[0]);
  assert.equal(c.gain, 70000); assert.equal(c.taxCost, 90000); assert.equal(c.taxGain, 30000);
});

test('sale lines balance and split gains by term', () => {
  const a = { id: 'a', type: 'equity' };
  const vs = [buy('b1', '2024-01-10', 10, 100000), buy('b2', '2026-03-01', 10, 150000)];
  const r = saleLines({ asset: a, vouchers: vs, date: '2026-04-15', qty: 15, proceeds: 270000, moneyLedgerId: 'bank', investLedgerId: 'stocks', gainLedgerFor: k => k });
  const dr = r.lines.reduce((s, l) => s + l.dr, 0), cr = r.lines.reduce((s, l) => s + l.cr, 0);
  assert.equal(dr, cr);
  assert.equal(r.cost, 175000);
  const lt = r.lines.find(l => l.ledgerId === 'gain_eq_lt'), st = r.lines.find(l => l.ledgerId === 'gain_eq_st');
  /* 10 old units: proceeds 1,80,000 vs cost 1,00,000 (long); 5 new units: proceeds 90,000 vs cost 75,000 (short) */
  assert.equal(lt.cr, 80000); assert.equal(st.cr, 15000);
});

test('capital gains: exemption, set-off order, crypto losses never set off', () => {
  const eq = { id: 'a', type: 'equity' };
  const gold = { id: 'g', type: 'gold' };
  const btc = { id: 'c', type: 'crypto' };
  const vs = [
    buy('b1', '2024-01-10', 100, 1_00_000_00), sell('s1', '2026-05-01', 100, 3_00_000_00),           /* LTCG equity 2L */
    { ...buy('g1', '2026-01-01', 10, 6_00_000_00), meta: { inv: { assetId: 'g', action: 'buy', qty: 10, cost: 6_00_000_00 } } },
    { ...sell('g2', '2026-06-01', 10, 5_50_000_00), meta: { inv: { assetId: 'g', action: 'sell', qty: 10, proceeds: 5_50_000_00 } } }, /* STCL other 50k */
    { ...buy('c1', '2026-04-05', 1, 50_000_00), meta: { inv: { assetId: 'c', action: 'buy', qty: 1, cost: 50_000_00 } } },
    { ...sell('c2', '2026-07-01', 1, 30_000_00), meta: { inv: { assetId: 'c', action: 'sell', qty: 1, proceeds: 30_000_00 } } }  /* crypto loss */
  ];
  const cg = capitalGains([eq, gold, btc], vs, '2026-27');
  assert.equal(cg.buckets.eqLT, 2_00_000_00);
  assert.equal(cg.afterSetoff.eqLT, 1_50_000_00);       /* short-term loss set off against long-term gain */
  assert.equal(cg.exempt, 1_25_000_00);
  assert.equal(cg.taxable.eqLT, 25_000_00);
  assert.equal(cg.tax.eqLT, Math.round(25_000_00 * 0.125));
  assert.equal(cg.taxable.vda, 0); assert.equal(cg.buckets.vdaLoss, -20_000_00);
});

test('valuation, deposits, FD accrual and trading turnover', () => {
  const a = { id: 'a', type: 'equity_mf', price: 15000 };
  const v = valueAsset(a, [buy('b1', '2024-01-10', 100, 1_000_000)], '2026-10-11');
  assert.equal(v.value, 1_500_000); assert.equal(v.gain, 500_000); assert.equal(v.ltQty, 100);
  const fd = { id: 'f', type: 'fd', fd: { principal: 1_00_000_00, rate: 7.2, start: '2025-10-11', maturity: '2027-10-11' } };
  const acc = fdAccrued(fd, '2026-10-11');
  assert.ok(acc > 1_07_300_00 && acc < 1_07_500_00, String(acc));
  const dep = depositState({ id: 'p', type: 'ppf', openingAmount: 5_00_000_00 }, [{ id: 'd', date: '2026-05-01', meta: { inv: { assetId: 'p', action: 'deposit', amount: 1_50_000_00 } }, lines: [] }]);
  assert.equal(dep.book, 6_50_000_00);
  const ts = tradingSummary([
    { date: '2026-05-01', meta: { trade: { segment: 'options', pl: 10_000_00, premium: 40_000_00, charges: 500_00 } } },
    { date: '2026-05-02', meta: { trade: { segment: 'futures', pl: -4_000_00, charges: 300_00 } } },
    { date: '2026-05-03', meta: { trade: { segment: 'intraday', pl: 2_000_00, charges: 100_00 } } }], '2026-27');
  assert.equal(ts.turnover, 10_000_00 + 40_000_00 + 4_000_00);
  assert.equal(ts.net, 10_000_00 - 4_000_00 + 2_000_00 - 900_00);
});

import { buildDemo } from '../js/core/demo.js';
import { makeCtx } from '../js/core/books.js';
import { unlinked } from '../js/core/invest.js';
import { checkEntity } from '../js/core/integrity.js';
test('demo investments tie out to the books, with a long-term sale and SIP units', () => {
  const d = buildDemo({ upto: '2026-10-11' });
  assert.deepEqual(checkEntity(d).issues, []);
  const c = makeCtx(d);
  const vals = d.assets.map(a => valueAsset(a, d.vouchers, '2026-10-11'));
  assert.deepEqual(unlinked(c, d.assets, vals).map(u => u.ledger.name + ' ' + u.diff), []);
  const infy = d.assets.find(a => a.name === 'Infosys');
  const f = fifo(infy, d.vouchers);
  assert.equal(f.qty, 100);
  assert.equal(classify(infy, f.realised[0]).term, 'long');
  const mf = vals.find(v => v.asset.type === 'equity_mf');
  assert.equal(mf.fifo.pendingCount, 0);
  assert.ok(mf.qty > 25000);
  const cg = capitalGains(d.assets, d.vouchers, '2026-27');
  assert.equal(cg.buckets.eqLT, 100 * 1700_00 - 40_00 - 150000_00);
});
