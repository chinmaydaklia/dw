import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEntity, seedMasters } from '../js/core/masters.js';
import { makeCtx, balances, headline, profitLoss } from '../js/core/books.js';
import { buildTransfer, newVoucher, validateVoucher } from '../js/core/vouchers.js';
import { parseQuick } from '../js/core/quick.js';
import { valueAsset, unlinkedEntries, sameMoney, linkAsPurchase } from '../js/core/invest.js';
import { planRows } from '../js/import/statement-plan.js';

function setup() {
  const entity = makeEntity({ name: 'You' });
  const { groups, ledgers } = seedMasters(entity);
  const L = n => ledgers.find(l => l.name === n).id;
  ledgers.find(l => l.name === 'SBI Savings').opening = 1_00_000_00;
  const vouchers = [];
  const asset = { id: 'a', entityId: entity.id, name: 'HDFC Bank', type: 'equity', ledgerId: L('Stocks') };
  return { entity, groups, ledgers, vouchers, L, asset, ctx: () => makeCtx({ entity, groups, ledgers, vouchers }) };
}

test('bank → Zerodha wallet is a transfer; buying from the wallet is the only investment', () => {
  const s = setup();
  const t = newVoucher(s.entity.id, buildTransfer(s.ctx(), { date: '2026-10-01', fromLedgerId: s.L('SBI Savings'), toLedgerId: s.L('Zerodha wallet (Kite funds)'), amount: 5000_00 }));
  assert.equal(t.type, 'contra');
  s.vouchers.push(t);
  let h = headline(s.ctx(), { asOf: '2026-10-31', from: '2026-04-01' });
  assert.equal(h.investments, 0, 'money in the wallet is not invested yet');
  assert.equal(h.netWorth, 1_00_000_00);
  s.vouchers.push(newVoucher(s.entity.id, { type: 'payment', src: 'investment', date: '2026-10-02', lines: [{ ledgerId: s.L('Stocks'), dr: 5000_00, cr: 0 }, { ledgerId: s.L('Zerodha wallet (Kite funds)'), dr: 0, cr: 5000_00 }], meta: { inv: { assetId: 'a', action: 'buy', qty: 3, cost: 5000_00 } } }));
  h = headline(s.ctx(), { asOf: '2026-10-31', from: '2026-04-01' });
  assert.equal(h.investments, 5000_00, 'invested once');
  assert.equal(balances(s.ctx()).get(s.L('Zerodha wallet (Kite funds)')).closing, 0);
  assert.equal(h.netWorth, 1_00_000_00, 'net worth unchanged by moving and investing your own money');
  assert.equal(valueAsset(s.asset, s.vouchers).cost, 5000_00);
  assert.equal(profitLoss(s.ctx(), {}).totalExpense, 0);
  assert.equal(unlinkedEntries(s.ctx(), [s.asset]).length, 0);
});

test('quick entry “5000 sbi to zerodha” is a transfer to the wallet', () => {
  const s = setup();
  const r = parseQuick(s.ctx(), '5000 sbi to zerodha', { ref: '2026-10-11' });
  assert.equal(r.draft.type, 'contra');
  assert.equal(r.draft.lines.find(l => l.dr).ledgerId, s.L('Zerodha wallet (Kite funds)'));
});

test('an imported bank payment into Mutual Funds is linked, not entered twice', () => {
  const s = setup();
  const mf = { id: 'm', entityId: s.entity.id, name: 'Flexi Cap', type: 'equity_mf', ledgerId: s.L('Mutual Funds') };
  const imported = newVoucher(s.entity.id, { type: 'payment', src: 'import', date: '2026-10-05', narration: 'BSE LTD MF SIP', lines: [{ ledgerId: s.L('Mutual Funds'), dr: 5000_00, cr: 0 }, { ledgerId: s.L('SBI Savings'), dr: 0, cr: 5000_00 }] });
  s.vouchers.push(imported);
  const un = unlinkedEntries(s.ctx(), [mf]);
  assert.equal(un.length, 1); assert.equal(un[0].amount, 5000_00);
  const dup = sameMoney(s.ctx(), [mf], { amount: 5000_00, date: '2026-10-07' });
  assert.equal(dup.length, 1, 'typing the same SIP two days later is spotted');
  const linked = linkAsPurchase(imported, un[0].ledgerId, mf, 61.234);
  assert.deepEqual(validateVoucher(s.ctx(), linked, { isNew: false }), []);
  s.vouchers[0] = linked;
  assert.equal(unlinkedEntries(s.ctx(), [mf]).length, 0);
  const v = valueAsset(mf, s.vouchers);
  assert.equal(v.qty, 61.234); assert.equal(v.cost, 5000_00);
  assert.equal(balances(s.ctx()).get(s.L('SBI Savings')).closing, 95000_00, 'bank reduced once');
});

test('statement import maps broker transfers to the wallet and MF payments to Mutual Funds', () => {
  const s = setup();
  const parsed = { txns: [
    { date: '2026-10-01', narration: 'NEFT/ZERODHA BROKING LTD/ADD FUNDS', debit: 5000_00, credit: 0 },
    { date: '2026-10-05', narration: 'ACH D- BSE LTD-MF SIP', debit: 2500_00, credit: 0 },
    { date: '2026-10-06', narration: 'UPI/SWIGGY', debit: 300_00, credit: 0 }] };
  const auto = narr => /zerodha/i.test(narr) ? { ledgerId: s.L('Zerodha wallet (Kite funds)'), hint: 'wallet' } : /bse ltd|mf sip/i.test(narr) ? { ledgerId: s.L('Mutual Funds'), hint: 'invest' } : null;
  const rows = planRows(s.ctx(), s.L('SBI Savings'), parsed, [], s.L('To sort later'), auto);
  assert.equal(rows[0].counterId, s.L('Zerodha wallet (Kite funds)')); assert.equal(rows[0].hint, 'wallet');
  assert.equal(rows[1].counterId, s.L('Mutual Funds')); assert.equal(rows[1].hint, 'invest');
  assert.equal(rows[2].counterId, s.L('To sort later'));
});
