import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTradewise, parseConsolePnl } from '../js/import/zerodha.js';
import { planZerodhaPnl, buildZerodhaPostings } from '../js/import/zerodha-plan.js';
import { parseDateAny } from '../js/lib/dates.js';
import { makeEntity, seedMasters } from '../js/core/masters.js';
import { makeCtx, balances, trialBalance } from '../js/core/books.js';
import { validateVoucher } from '../js/core/vouchers.js';
import { fifo, capitalGains, tradingSummary } from '../js/core/invest.js';

const HEAD = ['Symbol', 'ISIN', 'Entry Date', 'Exit Date', 'Quantity', 'Buy Value', 'Sell Value', 'Profit', 'Period of Holding', 'Fair Market Value', 'Taxable Profit', 'Turnover', 'Brokerage', 'Exchange Transaction Charges', 'IPFT', 'SEBI Charges', 'CGST', 'SGST', 'IGST', 'Stamp Duty', 'STT'];
const sheets = {
  'Equity and Non Equity': [['Summary']],
  'Tradewise Exits from 2026-04-01': [
    ['Client ID', 'AB1234'], [],
    ['Equity - Intraday'], HEAD,
    ['SBIN', 'INE062A01020', '2026-05-04', '2026-05-04', 100, 80000, 80600, 600, 0, '', '', 600, 20, 2, 0, 0, 3.96, 0, 0, 0, 20],
    [],
    ['Equity - Short Term'], HEAD,
    ['TCS', 'INE467B01029', '2026-01-10', '2026-06-15', 10, 35000, 39000, 4000, 156, '', 4000, '', 0, 1.5, 0, 0.1, 0.3, 0, 0, 0, 39],
    [],
    ['Equity - Long Term'], HEAD,
    ['INFY', 'INE009A01021', '2023-09-01', '2026-08-14', 60, 90000, 108000, 18000, 1078, '', 18000, '', 0, 3, 0, 0, 0.54, 0, 0, 0, 108],
    [],
    ['F&O'], HEAD,
    ['NIFTY26JUN24000CE', '', '2026-06-20', '2026-06-25', 75, 7500, 12000, 4500, 5, '', '', 4500, 40, 5, 0, 0, 8, 0, 0, 0, 6],
    ['NIFTY26JUNFUT', '', '2026-06-10', '2026-06-25', 75, 1800000, 1794000, -6000, 15, '', '', 6000, 40, 30, 0, 0, 12, 0, 0, 0, 225]
  ]
};
function books() {
  const entity = makeEntity({ name: 'You' });
  const { groups, ledgers } = seedMasters(entity);
  const L = n => ledgers.find(l => l.name === n).id;
  ledgers.find(l => l.name === 'Stocks').opening = 1_50_000_00;
  const infy = { id: 'infy', entityId: entity.id, name: 'Infosys', type: 'equity', symbol: 'INFY', isin: 'INE009A01021', ledgerId: L('Stocks'), openingLots: [{ id: 'l1', date: '2023-09-01', qty: 100, cost: 1_50_000_00 }] };
  return { entity, groups, ledgers, L, assets: [infy], vouchers: [] };
}

test('Tradewise Exits sheet: sections, dates, values and charges', () => {
  const t = parseTradewise(sheets, parseDateAny);
  assert.equal(t.error, undefined);
  assert.deepEqual(t.rows.map(r => r.kind), ['intraday', 'short', 'long', 'fo', 'fo']);
  const tcs = t.rows[1];
  assert.equal(tcs.entry, '2026-01-10'); assert.equal(tcs.exit, '2026-06-15');
  assert.equal(tcs.buy, 35000_00); assert.equal(tcs.sell, 39000_00); assert.equal(tcs.profit, 4000_00);
  assert.equal(tcs.charges, 190); assert.equal(tcs.stt, 39_00);
  assert.equal(t.rows[4].profit, -6000_00);
});

test('plan: held shares → sale only; others → purchase + sale; F&O per day per segment; posting balances', () => {
  const b = books();
  const ctx = makeCtx({ entity: b.entity, groups: b.groups, ledgers: b.ledgers, vouchers: b.vouchers });
  const plan = planZerodhaPnl(ctx, b.assets, parseTradewise(sheets, parseDateAny).rows);
  assert.equal(plan.delivery.find(d => d.row.symbol === 'INFY').action, 'sell-only');
  assert.equal(plan.delivery.find(d => d.row.symbol === 'TCS').action, 'buy+sell');
  assert.deepEqual(plan.trades.map(t => t.segment + ' ' + t.date), ['intraday 2026-05-04', 'futures 2026-06-25', 'options 2026-06-25']);
  const wallet = b.L('Zerodha wallet (Kite funds)');
  const keyIds = {};
  const ensure = k => keyIds[k] || (keyIds[k] = (() => { const l = { id: 'k_' + k, entityId: b.entity.id, groupId: b.groups.find(g => g.key === (k === 'trade_charges' ? 'profexp' : 'othinc')).id, name: k, opening: 0, taxTag: 'none', system: k }; b.ledgers.push(l); return l.id; })());
  const out = buildZerodhaPostings(ctx, b.assets, plan, { walletId: wallet, ledgerForType: () => b.L('Stocks'), sttLedgerId: b.L('Miscellaneous'), batchId: 'bat' });
  assert.deepEqual(out.problems, []);
  assert.equal(out.newAssets.length, 1);
  const vouchers = out.vouchers.map(v => ({ ...v, lines: v.lines.map(l => (b.ledgers.some(x => x.id === l.ledgerId) ? l : { ...l, ledgerId: ensure(l.ledgerId) })) }));
  const assets = [...b.assets, ...out.newAssets];
  const c2 = makeCtx({ entity: b.entity, groups: b.groups, ledgers: b.ledgers, vouchers });
  for (const v of vouchers) assert.deepEqual(validateVoucher(c2, v), [], v.narration);
  assert.equal(trialBalance(c2).diff, 0);
  assert.equal(fifo(b.assets[0], vouchers).qty, 40, 'INFY: 60 of 100 sold from your own lot');
  assert.equal(fifo(out.newAssets[0], vouchers).qty, 0, 'TCS bought and sold');
  const cg = capitalGains(assets, vouchers, '2026-27');
  assert.equal(cg.buckets.eqLT, 108000_00 - 354 - 90000_00);
  assert.equal(cg.buckets.eqST, 39000_00 - 190 - 35000_00);
  const ts = tradingSummary(vouchers, '2026-27');
  assert.equal(ts.turnover, 4500_00 + 6000_00, 'F&O turnover from Zerodha');
  /* wallet: money in from sales minus money out for purchases, STT and F&O */
  const w = balances(c2).get(wallet).closing;
  const expected = (108000_00 - 354) + (39000_00 - 190) - 35000_00 - (39_00 + 108_00) + (600_00 - 4596) + (4500_00 - 5900) + (-6000_00 - 30700);
  assert.equal(w, expected);
  /* importing the same file again is flagged */
  const again = planZerodhaPnl(c2, assets, parseTradewise(sheets, parseDateAny).rows);
  assert.ok(again.delivery.every(d => d.dup && !d.include));
  assert.ok(again.trades.every(t => t.dup && !t.include));
});

test('Console P&L export: symbol-wise realised P&L and charges', () => {
  const r = parseConsolePnl({ 'F&O': [['P&L Statement for F&O'], ['Charges', 1234.5], ['Total P&L', 9000], [], ['Symbol', 'ISIN', 'Quantity', 'Buy Value', 'Sell Value', 'Realized P&L', 'Realized P&L Pct.'], ['NIFTY24JUNFUT', '', 50, 100000, 109000, 9000, 9]] }, 'pnl-AB1234.xlsx');
  assert.equal(r.segment, 'fo'); assert.equal(r.charges, 123450); assert.equal(r.items[0].profit, 900000);
});
