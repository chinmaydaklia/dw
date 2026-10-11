import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEntity, seedMasters } from '../js/core/masters.js';
import { makeCtx, trialBalance, profitLoss, balanceSheet, ledgerStatement, cashFlow, cashDigital, netWorthSeries, family, balances } from '../js/core/books.js';
import { buildIncome, buildExpense, buildTransfer, buildLoan, buildDailySummary, buildInvestment, newVoucher, validateVoucher, nextNumber, inferType } from '../js/core/vouchers.js';
import { checkEntity } from '../js/core/integrity.js';
import { buildDemo } from '../js/core/demo.js';
import { parseQuick } from '../js/core/quick.js';
import { dueDates } from '../js/core/recurring.js';

function setup() {
  const entity = makeEntity({ name: 'You' });
  const { groups, ledgers } = seedMasters(entity);
  const L = n => ledgers.find(l => l.name === n).id;
  ledgers.find(l => l.name === 'SBI Savings').opening = 100000_00;
  ledgers.find(l => l.name === 'Home Loan').opening = -50000_00;
  const vouchers = [];
  const ctx = () => makeCtx({ entity, groups, ledgers, vouchers });
  const add = d => { const v = newVoucher(entity.id, d); assert.deepEqual(validateVoucher(ctx(), v), []); vouchers.push(v); return v; };
  return { entity, groups, ledgers, vouchers, ctx, add, L };
}

test('opening balances are balanced by capital; trial balance is zero', () => {
  const s = setup();
  const tb = trialBalance(s.ctx());
  assert.equal(tb.diff, 0);
  const cap = balances(s.ctx()).get(s.ctx().capital.id);
  assert.equal(cap.closing, -50000_00);
});

test('income with TDS: gross to income, TDS receivable, net to bank', () => {
  const s = setup();
  const c = s.ctx();
  s.add(buildIncome(c, { date: '2026-05-07', incomeLedgerId: s.L('Professional Fees – PNH'), moneyLedgerId: s.L('SBI Savings'), tdsLedgerId: s.L('TDS Receivable'), gross: 200000_00, tds: 20000_00 }));
  const b = balances(s.ctx());
  assert.equal(b.get(s.L('SBI Savings')).closing, 280000_00);
  assert.equal(b.get(s.L('TDS Receivable')).closing, 20000_00);
  assert.equal(b.get(s.L('Professional Fees – PNH')).closing, -200000_00);
  const pl = profitLoss(s.ctx(), { from: '2026-04-01', to: '2027-03-31' });
  assert.equal(pl.prof.receipts, 200000_00);
});

test('P&L, balance sheet and capital roll-forward tally', () => {
  const s = setup();
  let c = s.ctx();
  s.add(buildDailySummary(c, { date: '2026-04-02', incomeLedgerId: s.L('Clinic Receipts'), cashLedgerId: s.L('Cash in Hand'), digitalLedgerId: s.L('SBI Savings'), cash: 3000_00, digital: 7000_00, visits: 20 }));
  s.add(buildExpense(c, { date: '2026-04-03', moneyLedgerId: s.L('Credit Card'), splits: [{ ledgerId: s.L('Groceries'), amount: 1500_00 }, { ledgerId: s.L('Medical Consumables'), amount: 500_00 }] }));
  s.add(buildLoan(c, { date: '2026-04-05', kind: 'repay', loanLedgerId: s.L('Home Loan'), interestLedgerId: s.L('Home Loan Interest'), moneyLedgerId: s.L('SBI Savings'), principal: 1000_00, interest: 400_00 }));
  s.add(buildTransfer(c, { date: '2027-04-02', fromLedgerId: s.L('SBI Savings'), toLedgerId: s.L('Cash in Hand'), amount: 100_00 }));
  s.add(buildExpense(c, { date: '2027-04-03', moneyLedgerId: s.L('Cash in Hand'), splits: [{ ledgerId: s.L('Household'), amount: 100_00 }] }));
  c = s.ctx();
  const pl = profitLoss(c, { from: '2026-04-01', to: '2027-03-31' });
  assert.equal(pl.totalIncome, 10000_00);
  assert.equal(pl.totalExpense, 2400_00);
  assert.equal(pl.surplus, 7600_00);
  assert.equal(pl.prof.net, 9500_00);
  const bs = balanceSheet(c, { asOf: '2027-04-30', periodFrom: '2027-04-01' });
  assert.equal(bs.diff, 0);
  assert.equal(bs.capital.accumulated, 7600_00);
  assert.equal(bs.capital.current, -100_00);
  assert.equal(trialBalance(c, { to: '2027-04-30' }).diff, 0);
  const st = ledgerStatement(c, s.L('SBI Savings'), { from: '2026-04-03', to: '2027-03-31' });
  assert.equal(st.opening, 107000_00);
  assert.equal(st.closing, 105600_00);
  assert.equal(st.rows[0].particulars, 'Home Loan +1');
  const cd = cashDigital(c, { from: '2026-04-01', to: '2027-03-31' });
  assert.equal(cd.cash, 3000_00); assert.equal(cd.digital, 7000_00);
  const cf = cashFlow(c, { from: '2026-04-01', to: '2027-03-31' });
  assert.equal(cf.check, 0);
  assert.equal(cf.operating.total, 10000_00 - 400_00);
  assert.equal(cf.financing.total, -1000_00);
  const nw = netWorthSeries(c, { from: '2026-04-01', to: '2026-05-31' });
  assert.equal(nw[1].value, 50000_00 + 7600_00);
});

test('validation catches unbalanced, locked and cross-entity vouchers', () => {
  const s = setup();
  const c = s.ctx();
  const bad = newVoucher(s.entity.id, { date: '2026-04-01', lines: [{ ledgerId: s.L('Cash in Hand'), dr: 100, cr: 0 }, { ledgerId: s.L('Household'), dr: 0, cr: 99 }] });
  assert.ok(validateVoucher(c, bad).some(e => /do not match/.test(e)));
  s.entity.lockedUpto = '2026-03-31';
  const locked = newVoucher(s.entity.id, { date: '2026-03-15', lines: [{ ledgerId: s.L('Household'), dr: 100, cr: 0 }, { ledgerId: s.L('Cash in Hand'), dr: 0, cr: 100 }] });
  assert.ok(validateVoucher(c, locked).some(e => /locked/.test(e)));
  const frac = newVoucher(s.entity.id, { date: '2026-04-15', lines: [{ ledgerId: s.L('Household'), dr: 10.5, cr: 0 }, { ledgerId: s.L('Cash in Hand'), dr: 0, cr: 10.5 }] });
  assert.ok(validateVoucher(c, frac).some(e => /whole paise/.test(e)));
});

test('voucher numbers and type inference', () => {
  const s = setup();
  const c = s.ctx();
  const v = s.add(buildTransfer(c, { date: '2026-04-02', fromLedgerId: s.L('SBI Savings'), toLedgerId: s.L('Cash in Hand'), amount: 500 }));
  assert.equal(v.type, 'contra');
  v.no = nextNumber(s.vouchers, s.entity.id, 'contra', '2026-04-02');
  assert.equal(v.no, 'C/2026-27/0001');
  assert.equal(nextNumber(s.vouchers, s.entity.id, 'contra', '2026-05-02'), 'C/2026-27/0002');
  assert.equal(inferType(c, [{ ledgerId: s.L('Groceries'), dr: 5, cr: 0 }, { ledgerId: s.L('Credit Card'), dr: 0, cr: 5 }]), 'payment');
  const inv = buildInvestment(c, { date: '2026-04-02', kind: 'redeem', investLedgerId: s.L('Mutual Funds'), moneyLedgerId: s.L('SBI Savings'), gainLedgerId: s.L('Other Income'), amount: 1200, cost: 1000 });
  assert.deepEqual(inv.lines.map(l => [l.dr, l.cr]), [[1200, 0], [0, 1000], [0, 200]]);
});

test('quick entry parsing', () => {
  const s = setup();
  const c = s.ctx();
  let r = parseQuick(c, '450 petrol sbi', { ref: '2026-10-11' });
  assert.equal(r.draft.lines[0].ledgerId, s.L('Vehicle Running (Professional)'));
  assert.equal(r.draft.lines[1].ledgerId, s.L('SBI Savings'));
  assert.equal(r.amount, 45000);
  r = parseQuick(c, '+12k pnh sbi y', { ref: '2026-10-11' });
  assert.equal(r.date, '2026-10-10');
  assert.equal(r.draft.type, 'receipt');
  assert.equal(r.draft.lines.find(l => l.cr).ledgerId, s.L('Professional Fees – PNH'));
  r = parseQuick(c, '5000 sbi to cash', { ref: '2026-10-11' });
  assert.equal(r.draft.type, 'contra');
  assert.equal(r.draft.lines.find(l => l.dr).ledgerId, s.L('Cash in Hand'));
  r = parseQuick(c, '300 groceries', { ref: '2026-10-11', defaultMoneyId: s.L('Cash in Hand') });
  assert.equal(r.draft.lines.find(l => l.cr).ledgerId, s.L('Cash in Hand'));
  assert.ok(parseQuick(c, 'petrol').error);
});

test('recurring due dates clamp month ends and skip posted', () => {
  const rec = { startDate: '2026-01-31', freq: 'monthly', lastPosted: '2026-02-28' };
  assert.deepEqual(dueDates(rec, '2026-05-31'), ['2026-03-31', '2026-04-30', '2026-05-31']);
  assert.deepEqual(dueDates({ startDate: '2026-04-05', freq: 'quarterly' }, '2026-12-01'), ['2026-04-05', '2026-07-05', '2026-10-05']);
});

test('demo entity passes every integrity check', () => {
  const d = buildDemo({ upto: '2026-10-11' });
  const res = checkEntity(d);
  assert.deepEqual(res.issues, []);
  assert.ok(d.vouchers.length > 200);
  const c = makeCtx(d);
  const bs = balanceSheet(c, { asOf: '2026-10-11', periodFrom: '2026-04-01' });
  assert.equal(bs.diff, 0);
  const f = family([c], { asOf: '2026-10-11', from: '2026-04-01' });
  assert.equal(f.total.netWorth, bs.totalAssets - (bs.totalLiabilities - bs.capital.total));
});
