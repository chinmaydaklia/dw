import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPaise, formatINR, formatCompact, groupIndian } from '../js/lib/money.js';
import { fyOf, fyRange, addMonths, parseDateAny, monthsBetween } from '../js/lib/dates.js';

test('toPaise parses Indian formats without float drift', () => {
  assert.equal(toPaise('1,23,456.78'), 12345678);
  assert.equal(toPaise('₹ 500'), 50000);
  assert.equal(toPaise('0.1'), 10);
  assert.equal(toPaise('0.29'), 29);
  assert.equal(toPaise('-12.5'), -1250);
  assert.equal(toPaise('(250.00)'), -25000);
  assert.equal(toPaise('12k'), 1200000);
  assert.equal(toPaise('1.5L'), 15000000);
  assert.equal(toPaise('2cr'), 2000000000);
  assert.equal(toPaise('12.345'), 1235);
  assert.equal(toPaise('abc'), null);
  assert.equal(toPaise(''), null);
  assert.equal(toPaise(1234.5), 123450);
});
test('formatINR uses lakh grouping and explicit signs', () => {
  assert.equal(groupIndian('12345678'), '1,23,45,678');
  assert.equal(formatINR(12345600), '₹1,23,456');
  assert.equal(formatINR(12345678), '₹1,23,456.78');
  assert.equal(formatINR(-5000), '−₹50');
  assert.equal(formatINR(5000, { sign: true }), '+₹50');
  assert.equal(formatCompact(4250000_00 / 10), '₹4.25 L');
  assert.equal(formatCompact(12000000_00), '₹1.2 Cr');
});
test('financial year helpers', () => {
  assert.equal(fyOf('2026-03-31'), '2025-26');
  assert.equal(fyOf('2026-04-01'), '2026-27');
  assert.deepEqual(fyRange('2026-27'), { from: '2026-04-01', to: '2027-03-31' });
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-01-31', 2, 31), '2026-03-31');
  assert.deepEqual(monthsBetween('2026-11-15', '2027-02-01'), ['2026-11', '2026-12', '2027-01', '2027-02']);
});
test('day-first date parsing', () => {
  assert.equal(parseDateAny('05/04/2026'), '2026-04-05');
  assert.equal(parseDateAny('5-Apr-26'), '2026-04-05');
  assert.equal(parseDateAny('05 Apr 2026 10:22'), '2026-04-05');
  assert.equal(parseDateAny('2026-04-05'), '2026-04-05');
  assert.equal(parseDateAny('31/02/2026'), '');
  assert.equal(parseDateAny(46117), '2026-04-05');
});
