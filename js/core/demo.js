/* Practice entity with a realistic year of sample data. Deterministic, deletable any time. */
import { makeEntity, seedMasters } from './masters.js';
import { makeCtx } from './books.js';
import { newVoucher, buildIncome, buildExpense, buildTransfer, buildLoan, buildDailySummary, buildInvestment } from './vouchers.js';
import { fyOf, fyRange, addDays, addMonths, today } from '../lib/dates.js';
import { rng, uid, nowISO } from '../lib/util.js';

export function buildDemo({ upto = today(), order = 9 } = {}) {
  const entity = makeEntity({ name: 'Demo (practice)', kind: 'demo', accent: '#7c8db5', template: 'self', order });
  const { groups, ledgers } = seedMasters(entity, 'self');
  const L = name => ledgers.find(l => l.name === name).id;
  const set = (name, opening) => { ledgers.find(l => l.name === name).opening = opening; };
  set('SBI Savings', 450000_00); set('Bank of Baroda', 125000_00); set('Cash in Hand', 18000_00);
  set('Mutual Funds', 1200000_00); set('Fixed Deposits', 500000_00); set('PPF', 650000_00);
  set('Loan to Arihant Medicos', 1000000_00); set('Vehicles', 900000_00);
  set('Home Loan', -3200000_00); set('Credit Card', -24000_00);

  const ctx = makeCtx({ entity, groups, ledgers, vouchers: [] });
  const site = n => entity.sites.find(s => s.name === n).id;
  const r = rng(20261011);
  const vouchers = [];
  const add = d => vouchers.push(newVoucher(entity.id, d));
  const start = fyRange(fyOf(upto)).from;
  const amt = (lo, hi) => Math.round((lo + r() * (hi - lo)) / 10) * 1000; /* whole tens of rupees, in paise */

  for (let d = start; d <= upto; d = addDays(d, 1)) {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    if (dow !== 0 && r() < 0.85) {
      const visits = 8 + Math.floor(r() * 18);
      const cash = amt(visits * 120, visits * 220), digital = amt(visits * 260, visits * 420);
      add(buildDailySummary(ctx, { date: d, siteId: site('Clinic'), incomeLedgerId: L('Clinic Receipts'), cashLedgerId: L('Cash in Hand'), digitalLedgerId: L('SBI Savings'), cash, digital, visits, narration: 'Clinic OPD' }));
    }
    const day = Number(d.slice(8, 10));
    if (day === 7) {
      for (const [h, lo, hi] of [['PNH', 180000, 260000], ['DKM', 90000, 150000]]) {
        const gross = amt(lo, hi), tds = Math.round(gross * 0.1);
        add(buildIncome(ctx, { date: d, incomeLedgerId: L('Professional Fees – ' + h), moneyLedgerId: L('SBI Savings'), tdsLedgerId: L('TDS Receivable'), gross, tds, narration: h + ' fees for ' + addMonths(d, -1).slice(0, 7), tags: { siteId: site(h) } }));
      }
    }
    if (day === 1) {
      add(buildExpense(ctx, { date: d, moneyLedgerId: L('SBI Savings'), splits: [{ ledgerId: L('Clinic Rent'), amount: 35000_00 }], narration: 'Clinic rent', tags: { siteId: site('Clinic') } }));
      add(buildExpense(ctx, { date: d, moneyLedgerId: L('Cash in Hand'), splits: [{ ledgerId: L('Staff Salary'), amount: 28000_00 }], narration: 'Staff salary (2)' }));
    }
    if (day === 5) add(buildLoan(ctx, { date: d, kind: 'repay', loanLedgerId: L('Home Loan'), interestLedgerId: L('Home Loan Interest'), moneyLedgerId: L('SBI Savings'), principal: 14200_00, interest: 23800_00, narration: 'Home loan EMI' }));
    if (day === 10) add(buildInvestment(ctx, { date: d, kind: 'invest', investLedgerId: L('Mutual Funds'), moneyLedgerId: L('SBI Savings'), amount: 25000_00, narration: 'SIP – Flexi cap' }));
    if (day === 12) add(buildTransfer(ctx, { date: d, fromLedgerId: L('Cash in Hand'), toLedgerId: L('Bank of Baroda'), amount: amt(12000, 22000), narration: 'Cash deposited' }));
    if (day === 15) {
      add(buildExpense(ctx, { date: d, moneyLedgerId: L('Credit Card'), splits: [{ ledgerId: L('Groceries'), amount: amt(9000, 14000) }, { ledgerId: L('Dining & Entertainment'), amount: amt(3000, 8000) }, { ledgerId: L('Fuel (Personal)'), amount: amt(4000, 7000) }], narration: 'Card spends' }));
      add(buildExpense(ctx, { date: d, moneyLedgerId: L('Bank of Baroda'), splits: [{ ledgerId: L('Household'), amount: amt(15000, 22000) }, { ledgerId: L('Utilities (Home)'), amount: amt(3000, 6000) }], narration: 'Home expenses' }));
      add(buildExpense(ctx, { date: d, moneyLedgerId: L('Cash in Hand'), splits: [{ ledgerId: L('Medical Consumables'), amount: amt(6000, 12000) }], narration: 'Consumables', tags: { siteId: site('Clinic') } }));
    }
    if (day === 20) add(buildTransfer(ctx, { date: d, fromLedgerId: L('SBI Savings'), toLedgerId: L('Credit Card'), amount: amt(18000, 24000), narration: 'Card bill' }));
    if (day === 28 && ['06', '09', '12', '03'].includes(d.slice(5, 7)))
      add(buildLoan(ctx, { date: d, kind: 'recover', loanLedgerId: L('Loan to Arihant Medicos'), interestLedgerId: L('Interest – Loans Given'), moneyLedgerId: L('SBI Savings'), principal: 0, interest: 30000_00, narration: 'Interest from Arihant (12% p.a.)' }));
    if (d.slice(5) === '06-15' || d.slice(5) === '09-15' || d.slice(5) === '12-15' || d.slice(5) === '03-15')
      add(buildTransfer(ctx, { date: d, fromLedgerId: L('SBI Savings'), toLedgerId: L('Advance Tax Paid'), amount: 60000_00, narration: 'Advance tax instalment' }));
  }
  vouchers.forEach((v, i) => { v.createdAt = new Date(Date.parse(v.date + 'T09:00:00Z') + i).toISOString(); });
  const recurring = [{
    id: uid('rec'), entityId: entity.id, name: 'Home loan EMI', freq: 'monthly', startDate: addMonths(start, 0).slice(0, 8) + '05', endDate: '', lastPosted: '', paused: false,
    template: { type: 'payment', src: 'loan', narration: 'Home loan EMI', lines: [{ ledgerId: L('Home Loan'), dr: 14200_00, cr: 0 }, { ledgerId: L('Home Loan Interest'), dr: 23800_00, cr: 0 }, { ledgerId: L('SBI Savings'), dr: 0, cr: 38000_00 }], tags: {} },
    createdAt: nowISO()
  }];
  /* mark the months already generated as posted so only future EMIs are offered */
  const lastEmi = vouchers.filter(v => v.narration === 'Home loan EMI').map(v => v.date).sort().pop();
  recurring[0].lastPosted = lastEmi || '';
  const rules = [
    { id: uid('rul'), entityId: entity.id, pattern: 'swiggy', ledgerId: L('Dining & Entertainment'), dir: 'debit', createdAt: nowISO() },
    { id: uid('rul'), entityId: entity.id, pattern: 'pnh', ledgerId: L('Professional Fees – PNH'), dir: 'credit', createdAt: nowISO() }
  ];
  return { entity, groups, ledgers, vouchers, recurring, rules };
}
