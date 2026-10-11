/* Practice entity with a realistic year of sample data. Deterministic, deletable any time. */
import { makeEntity, seedMasters, makeLedger, GAIN_LEDGERS } from './masters.js';
import { saleLines } from './invest.js';
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
  set('Mutual Funds', 1200000_00); set('Fixed Deposits', 500000_00); set('PPF', 650000_00); set('Stocks', 300000_00);
  set('Loan to Arihant Medicos', 1000000_00); set('Vehicles', 900000_00);
  set('Home Loan', -3200000_00); set('Credit Card', -24000_00);

  const ctx = makeCtx({ entity, groups, ledgers, vouchers: [] });
  const site = n => entity.sites.find(s => s.name === n).id;
  const r = rng(20261011);
  const vouchers = [];
  const add = d => vouchers.push(newVoucher(entity.id, d));
  /* investments: opening holdings match the opening balances above */
  const ast = (name, type, ledger, extra) => ({ id: uid('ast'), entityId: entity.id, name, type, ledgerId: L(ledger), symbol: '', isin: '', price: 0, priceDate: '', openingLots: [], events: [], openingAmount: 0, archived: false, closed: false, createdAt: nowISO(), updatedAt: nowISO(), ...extra });
  const ppfas = ast('Parag Parikh Flexi Cap – Direct', 'equity_mf', 'Mutual Funds', { schemeCode: '122639', price: 8850, priceDate: upto,
    openingLots: [{ id: uid('lot'), date: '2021-06-10', qty: 14500, cost: 600000_00 }, { id: uid('lot'), date: '2023-02-15', qty: 7800, cost: 400000_00 }, { id: uid('lot'), date: '2024-08-20', qty: 2700, cost: 200000_00 }] });
  const infy = ast('Infosys', 'equity', 'Stocks', { symbol: 'INFY', isin: 'INE009A01021', price: 175000, priceDate: upto, openingLots: [{ id: uid('lot'), date: '2023-09-01', qty: 200, cost: 300000_00 }] });
  const hdfc = ast('HDFC Bank', 'equity', 'Stocks', { symbol: 'HDFCBANK', isin: 'INE040A01034', price: 172500, priceDate: upto });
  const btc = ast('Bitcoin', 'crypto', 'Crypto (CoinDCX)', { coinId: 'bitcoin', price: 58_00_000_00, priceDate: upto });
  const fd = ast('SBI FD (2 years)', 'fd', 'Fixed Deposits', { openingAmount: 500000_00, fd: { principal: 500000_00, rate: 7.1, start: '2025-08-01', maturity: '2027-08-01', payout: 'cumulative' } });
  const ppf = ast('PPF – SBI', 'ppf', 'PPF', { openingAmount: 650000_00 });
  const assets = [ppfas, infy, hdfc, btc, fd, ppf];
  const gainLedger = key => { let l = ledgers.find(x => x.system === key); if (!l) { const def = GAIN_LEDGERS[key]; l = makeLedger({ entityId: entity.id, groupId: groups.find(g => g.key === (def.expense ? 'profexp' : 'othinc')).id, name: def.name, system: key, taxTag: def.tag }); ledgers.push(l); } return l.id; };
  let nav = 8000;
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
    if (day === 10) {
      nav = Math.round(nav * (1 + 0.012 + (r() - 0.5) * 0.02));
      const qty = Math.round(25000_00 / nav * 1000) / 1000;
      const v = buildInvestment(ctx, { date: d, kind: 'invest', investLedgerId: L('Mutual Funds'), moneyLedgerId: L('SBI Savings'), amount: 25000_00, narration: 'SIP – Flexi cap' });
      add({ ...v, meta: { inv: { assetId: ppfas.id, action: 'buy', qty, cost: 25000_00, price: nav, charges: 0 } } });
    }
    if (d.slice(5) === '05-20') add({ type: 'payment', src: 'investment', date: d, narration: 'Bought HDFC Bank', lines: [{ ledgerId: L('Stocks'), dr: 82520_00, cr: 0 }, { ledgerId: L('SBI Savings'), dr: 0, cr: 82520_00 }], meta: { inv: { assetId: hdfc.id, action: 'buy', qty: 50, cost: 82520_00, price: 165000, charges: 20_00 } } });
    if (d.slice(5) === '06-01') add({ type: 'payment', src: 'investment', date: d, narration: 'Bought Bitcoin on CoinDCX', lines: [{ ledgerId: L('Crypto (CoinDCX)'), dr: 55000_00, cr: 0 }, { ledgerId: L('SBI Savings'), dr: 0, cr: 55000_00 }], meta: { inv: { assetId: btc.id, action: 'buy', qty: 0.01, cost: 55000_00, price: 55_00_000_00, charges: 0 } } });
    if (d.slice(5) === '07-15') add({ type: 'receipt', src: 'investment', date: d, narration: 'Dividend – HDFC Bank', lines: [{ ledgerId: L('SBI Savings'), dr: 950_00, cr: 0 }, { ledgerId: L('Dividend'), dr: 0, cr: 950_00 }], meta: { inv: { assetId: hdfc.id, action: 'dividend', amount: 950_00 } } });
    if (d.slice(5) === '08-14') {
      const proceeds = 100 * 1700_00 - 40_00;
      const sl = saleLines({ asset: infy, vouchers, date: d, qty: 100, proceeds, moneyLedgerId: L('SBI Savings'), investLedgerId: L('Stocks'), gainLedgerFor: gainLedger });
      add({ type: 'receipt', src: 'investment', date: d, narration: 'Sold Infosys', lines: sl.lines, meta: { inv: { assetId: infy.id, action: 'sell', qty: 100, proceeds, gross: 170000_00, charges: 40_00, price: 1700_00 } } });
    }
    if (d.slice(5) === '09-30') {
      const pl = 18400_00, ch = 1650_00;
      add({ type: 'receipt', src: 'trading', date: d, narration: 'F&O options – September', lines: [{ ledgerId: L('Zerodha Funds (Kite)'), dr: pl - ch, cr: 0 }, { ledgerId: gainLedger('trade_charges'), dr: ch, cr: 0 }, { ledgerId: gainLedger('trade_fo'), dr: 0, cr: pl }], meta: { trade: { segment: 'options', pl, charges: ch, stt: 600_00, premium: 72000_00 } } });
    }
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
  return { entity, groups, ledgers, vouchers, recurring, rules, assets };
}
