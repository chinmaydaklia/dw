/* Real-bank PDF layouts (made-up data): SBI and Bank of Baroda quirks the statement parser must handle. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePdfStatement } from '../js/import/statement-parse.js';

/* build pdf.js-like lines: [y, [[x0, x1, text], ...]] */
const L = (y, cells, h = 7.5) => ({ y, h, cells: cells.map(([x0, x1, t]) => ({ t, x0, x1 })) });

test('SBI: Credit before Debit, "0" fillers, rupee sign, description printed above the date', () => {
  const page = [
    L(700, [[30, 52, 'Date'], [130, 232, 'Transaction Reference'], [300, 372, 'Ref.No./Chq.No.'], [405, 432, 'Credit'], [472, 496, 'Debit'], [535, 571, 'Balance']]),
    L(684, [[22, 165, 'Your Opening Balance on 01-08-26:'], [170, 216, '₹ 1000.00']]),
    L(668, [[25, 59, '03-08-26'], [65, 260, 'UPI/DR/111111111111/SHOP A/HDFC/x/NO RE'], [369, 372, '-'], [435, 440, '0'], [480, 510, '200.00'], [544, 580, '800.00']]),
    L(657, [[65, 209, 'PFN 1234 SALARY CREDIT LTD']]),            /* above its date row */
    L(652, [[25, 59, '04-08-26'], [369, 372, '-'], [420, 440, '500.00'], [505, 510, '0'], [544, 580, '1300.00']]),
    L(643, [[65, 149, 'NACH0000000001']]),                         /* below its date row */
    L(628, [[25, 59, '05-08-26'], [65, 260, 'UPI/DR/222222222222/SHOP B/YESB/y/UPI'], [369, 372, '-'], [435, 440, '0'], [480, 510, '50.00'], [544, 580, '1250.00']]),
    L(612, [[22, 165, 'Your Closing Balance on 31-08-26:'], [170, 216, '₹ 1250.00']]),
    L(600, [[20, 300, 'Contents of this statement will be considered correct if no error is reported within 30 days']])
  ];
  const r = parsePdfStatement([page]);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.txns.map(t => [t.date, t.debit, t.credit, t.balance]), [
    ['2026-08-03', 20000, 0, 80000], ['2026-08-04', 0, 50000, 130000], ['2026-08-05', 5000, 0, 125000]]);
  assert.equal(r.txns[0].narration, 'UPI/DR/111111111111/SHOP A/HDFC/x/NO RE');
  assert.equal(r.txns[1].narration, 'PFN 1234 SALARY CREDIT LTD NACH0000000001');
  assert.equal(r.opening, 100000); assert.equal(r.closing, 125000); assert.equal(r.arith, 0);
});

test('Bank of Baroda: serial-number column, dated Opening Balance row, two-line header, footer note', () => {
  const page = [
    L(700, [[22, 42, 'Serial'], [50, 91, 'Transaction'], [108, 128, 'Value'], [145, 185, 'Description'], [318, 345, 'Cheque'], [410, 429, 'Debit'], [475, 496, 'Credit'], [545, 573, 'Balance']]),
    L(692, [[26, 36, 'No'], [60, 77, 'Date'], [110, 127, 'Date'], [318, 346, 'Number']]),
    L(672, [[30, 34, '1'], [50, 91, '30-08-2026'], [145, 205, 'Opening Balance'], [427, 430, '-'], [497, 500, '-'], [541, 572, '1,000.00']]),
    L(650, [[30, 34, '2'], [50, 91, '30-08-2026'], [103, 332, '30-08-2026 UPI/333333333333/UPI/x@upi/N'], [427, 430, '-'], [464, 500, '4,000.00'], [536, 572, '5,000.00']]),
    L(642, [[145, 158, 'O R']]),
    L(628, [[30, 34, '3'], [50, 91, '04-09-2026'], [103, 273, '04-09-2026 Loan Recovery For99990000001'], [394, 430, '3,000.00'], [497, 500, '-'], [541, 572, '2,000.00']]),
    L(606, [[25, 468, 'Note: In case you find any discrepancy, we advise you to take up with your base branch.']])
  ];
  const r = parsePdfStatement([page]);
  assert.deepEqual(r.txns.map(t => [t.date, t.debit, t.credit, t.balance, t.narration]), [
    ['2026-08-30', 0, 400000, 500000, 'UPI/333333333333/UPI/x@upi/N O R'],
    ['2026-09-04', 300000, 0, 200000, 'Loan Recovery For99990000001']]);
  assert.equal(r.opening, 100000); assert.equal(r.arith, 0);
});

test('Bank of Baroda e-statement: savings and loan accounts are split; loan section read separately', () => {
  const hdr = y => L(y, [[42, 60, 'DATE'], [140, 190, 'NARRATION'], [290, 350, 'WITHDRAWAL (DR)'], [400, 450, 'DEPOSIT (CR)'], [530, 560, 'BALANCE']]);
  const page = [
    L(760, [[35, 300, 'LOAN ACCOUNT INR 0.00 -500000.00']]),
    L(740, [[30, 500, 'Statement of transactions in Savings Account 11112222333344 in INR for the period Aug 01, 2026 - Aug 31, 2026']]),
    hdr(726),
    L(712, [[30, 70, '01-08-2026'], [80, 140, 'Opening Balance'], [520, 570, '5000.00 Cr']]),
    L(698, [[30, 70, '04-08-2026'], [80, 250, 'Loan Recovery For99990000001'], [330, 370, '3000.00'], [520, 570, '2000.00 Cr']]),
    L(684, [[30, 70, '31-08-2026'], [80, 140, 'Closing Balance'], [520, 570, '2000.00 Cr']]),
    L(660, [[30, 500, 'Statement of transactions in Loan Account 99990000001 in INR for the period Aug 01, 2026 - Aug 31, 2026']]),
    L(646, [[30, 90, 'SANCTIONED DATE'], [110, 180, 'SANCTIONED AMOUNT'], [225, 240, 'EMI'], [290, 315, 'TENURE'], [350, 380, 'ROI (%)']]),
    L(634, [[40, 80, '08-05-2024'], [125, 170, '600000.00'], [215, 245, '3000.00'], [295, 315, '240 M'], [355, 365, '8.5']]),
    hdr(620),
    L(606, [[30, 70, '01-08-2026'], [80, 140, 'Opening Balance'], [520, 570, '500000.00 Dr']]),
    L(592, [[30, 70, '04-08-2026'], [80, 250, '99990000001:Normal Int.Coll:04-07-2026 to 03-0'], [330, 370, '1200.00'], [520, 570, '501200.00 Dr']]),
    L(578, [[30, 70, '04-08-2026'], [80, 250, 'Loan Coll. From11112222333344'], [430, 470, '3000.00'], [520, 570, '498200.00 Dr']]),
    L(564, [[30, 70, '31-08-2026'], [80, 140, 'Closing Balance'], [520, 570, '498200.00 Dr']])
  ];
  const r = parsePdfStatement([page]);
  assert.equal(r.txns.length, 1);
  assert.deepEqual([r.txns[0].debit, r.opening, r.closing, r.arith], [300000, 500000, 200000, 0]);
  assert.equal(r.loans.length, 1);
  const ln = r.loans[0];
  assert.equal(ln.acct, '99990000001');
  assert.deepEqual([ln.opening, ln.closing, ln.totalDebit, ln.totalCredit, ln.arith], [-50000000, -49820000, 120000, 300000, 0]);
  assert.deepEqual([ln.detail.emi, ln.detail.rate], [300000, 8.5]);
});
