import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseTableStatement, groupPdfItems, parsePdfStatement, detectBank } from '../js/import/statement-parse.js';
import { planRows, rowToVoucher, ruleMatch, suggestKeyword } from '../js/import/statement-plan.js';
import { parseTaxPnl, parseHoldings } from '../js/import/zerodha.js';
import { makeEntity, seedMasters } from '../js/core/masters.js';
import { makeCtx, balances } from '../js/core/books.js';
import { validateVoucher } from '../js/core/vouchers.js';

const CSV = `State Bank of India
Account Statement,,,,,
Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance
01-04-2026,01-04-2026,Opening,,,,"1,00,000.00"
02-04-2026,02-04-2026,UPI/DR/412345678901/SWIGGY/YESB,412345678901,450.00,,"99,550.00"
03-04-2026,03-04-2026,NEFT CR PNH HOSPITAL FEES,N123456,,"18,000.00","1,17,550.00"
,,continued line,,,,
05-04-2026,05-04-2026,ATM WDL,,"5,000.00",,"1,12,550.00"
Closing Balance,,,,,,"1,12,550.00"`;

test('CSV statement: columns, wrapped narration, balances check', () => {
  const rows = parseCSV(CSV);
  const res = parseTableStatement(rows);
  assert.equal(res.error, undefined);
  assert.equal(res.bank, 'sbi');
  assert.equal(res.txns.length, 3);
  assert.equal(res.txns[0].debit, 45000);
  assert.equal(res.txns[1].credit, 1800000);
  assert.match(res.txns[1].narration, /continued line/);
  assert.equal(res.closing, 11255000);
  assert.equal(res.opening, 10000000);
  assert.equal(res.arith, 0);
  assert.ok(res.txns.every(t => t.check === 'ok'));
});

test('single amount column with Dr/Cr and descending order', () => {
  const rows = [['Date', 'Narration', 'Amount', 'Dr/Cr', 'Balance'],
    ['05/04/2026', 'Salary', '1000.00', 'CR', '3000.00'],
    ['04/04/2026', 'Rent', '500.00', 'DR', '2000.00'],
    ['03/04/2026', 'Open dep', '2500.00', 'CR', '2500.00']];
  const res = parseTableStatement(rows);
  assert.equal(res.txns[0].date, '2026-04-03');
  assert.equal(res.txns[1].debit, 50000);
  assert.equal(res.txns[2].credit, 100000);
  assert.equal(res.closing, 300000);
});

test('PDF text items are grouped into lines and parsed', () => {
  const it = (s, x, y) => ({ str: s, transform: [1, 0, 0, 9, x, y], width: s.length * 4.5 });
  const items = [
    it('HDFC BANK', 10, 800),
    it('Date', 10, 700), it('Narration', 80, 700), it('Withdrawal Amt.', 300, 700), it('Deposit Amt.', 380, 700), it('Closing Balance', 460, 700),
    it('Opening Balance', 10, 690), it('10,000.00', 470, 690),
    it('01/04/26', 10, 680), it('UPI-ZOMATO', 80, 680), it('250.00', 310, 680), it('9,750.00', 470, 680),
    it('02/04/26', 10, 670), it('NEFT-DKM HOSPITAL', 80, 670), it('5,000.00', 390, 670), it('14,750.00', 470, 670),
    it('FEES APRIL', 80, 662)
  ];
  const res = parsePdfStatement([groupPdfItems(items)]);
  assert.equal(res.error, undefined);
  assert.equal(res.bank, 'hdfc');
  assert.equal(res.txns.length, 2);
  assert.equal(res.txns[0].debit, 25000);
  assert.equal(res.txns[1].credit, 500000);
  assert.match(res.txns[1].narration, /FEES APRIL/);
  assert.equal(res.arith, 0);
});

test('plan rows: rules, exact duplicates on re-import, posting', () => {
  const entity = makeEntity({ name: 'You' });
  const { groups, ledgers } = seedMasters(entity);
  const L = n => ledgers.find(l => l.name === n).id;
  const vouchers = [];
  const rules = [{ pattern: 'swiggy', ledgerId: L('Dining & Entertainment'), dir: 'debit' }, { pattern: 'pnh', ledgerId: L('Professional Fees – PNH'), dir: 'credit' }];
  assert.equal(ruleMatch(rules, 'UPI/DR/4123/SWIGGY', 'debit').pattern, 'swiggy');
  assert.equal(suggestKeyword('UPI/DR/412345678901/SWIGGY/YESB'), 'swiggy');
  const parsed = parseTableStatement(parseCSV(CSV));
  let ctx = makeCtx({ entity, groups, ledgers, vouchers });
  const rows = planRows(ctx, L('SBI Savings'), parsed, rules, L('To sort later'));
  assert.equal(rows[0].counterId, L('Dining & Entertainment'));
  assert.equal(rows[1].counterId, L('Professional Fees – PNH'));
  assert.equal(rows[2].counterId, L('To sort later'));
  for (const r of rows) { const v = rowToVoucher(ctx, L('SBI Savings'), r, 'b1', 'sbi'); assert.deepEqual(validateVoucher(ctx, v), []); vouchers.push(v); }
  ctx = makeCtx({ entity, groups, ledgers, vouchers });
  assert.equal(balances(ctx).get(L('SBI Savings')).closing, 1800000 - 45000 - 500000);
  const again = planRows(ctx, L('SBI Savings'), parseTableStatement(parseCSV(CSV)), rules, L('To sort later'));
  assert.ok(again.every(r => r.dup && !r.include), 're-import is flagged as duplicate');
});

test('Zerodha tax P&L and holdings parsers', () => {
  const sheets = {
    'Equity and Non Equity': [['Summary'], ['Short Term profit', 12500.5], ['Long Term profit', '1,40,000'], ['Intraday/Speculative profit', -300]],
    'F&O': [['Options Realized Profit', 2000], ['Futures Realized Profit', 0]],
    'Equity Dividends': [['Symbol', 'ISIN', 'Net Dividend Amount'], ['HDFCBANK', 'INE040A01034', 190], ['ITC', 'INE154A01025', 62.5]]
  };
  const t = parseTaxPnl(sheets, 'taxpnl-AB1234-2025_2026-Q1-Q4.xlsx');
  assert.equal(t.fy, '2025-26');
  assert.equal(t.stcg, 1250050); assert.equal(t.ltcg, 14000000); assert.equal(t.intraday, -30000);
  assert.equal(t.dividends, 25250); assert.equal(t.dividendRows, 2);
  const h = parseHoldings([['Client ID AB1234'], [], ['Symbol', 'ISIN', 'Quantity Available', 'Average Price', 'Previous Closing Price'], ['INFY', 'INE009A01021', 10, 1500, 1620.5]]);
  assert.equal(h.items[0].cost, 1500000); assert.equal(h.items[0].value, 1620500);
  assert.equal(detectBank('IFSC: KKBK0001234'), 'kotak');
});
