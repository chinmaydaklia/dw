import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSync, renumberDuplicates, crossDeviceDuplicates } from '../js/core/sync.js';
import { nextNumber } from '../js/core/vouchers.js';

const side = (data, extra = {}) => ({ data, tombstones: {}, pristine: false, seedIds: [], ...extra });
const v = (id, t, extra = {}) => ({ id, entityId: 'e1', updatedAt: t, narration: id, ...extra });
/* apply a merge result to one side, as the store does */
function apply(s, res) {
  const data = {};
  for (const [k, list] of Object.entries(s.data)) data[k] = list.slice();
  for (const [k, list] of Object.entries(res.puts)) { data[k] = data[k] || []; for (const r of list) { const i = data[k].findIndex(x => x.id === r.id); if (i >= 0) data[k][i] = r; else data[k].push(r); } }
  for (const [k, ids] of Object.entries(res.dels)) data[k] = (data[k] || []).filter(x => !ids.includes(x.id));
  return { ...s, data, tombstones: res.tombstones };
}
const canon = s => JSON.stringify(Object.fromEntries(Object.entries(s.data).map(([k, l]) => [k, l.slice().sort((a, b) => a.id.localeCompare(b.id))])));
const both = (A, B) => { const ra = mergeSync(A, B), rb = mergeSync(B, A); return [apply(A, ra), apply(B, rb), ra, rb]; };

test('edits to different records on two devices both survive; devices converge', () => {
  const A = side({ vouchers: [v('a', '2026-10-01T10:00:00.000Z'), v('b', '2026-10-01T10:00:00.000Z')] });
  const B = side({ vouchers: [v('a', '2026-10-01T10:00:00.000Z'), v('b', '2026-10-01T10:00:00.000Z')] });
  A.data.vouchers[0] = v('a', '2026-10-02T09:00:00.000Z', { narration: 'edited on laptop' });
  B.data.vouchers[1] = v('b', '2026-10-02T09:30:00.000Z', { narration: 'edited on phone' });
  B.data.vouchers.push(v('c', '2026-10-02T09:31:00.000Z'));
  const [A2, B2, ra, rb] = both(A, B);
  assert.equal(canon(A2), canon(B2));
  assert.equal(A2.data.vouchers.find(x => x.id === 'a').narration, 'edited on laptop');
  assert.equal(A2.data.vouchers.find(x => x.id === 'b').narration, 'edited on phone');
  assert.ok(A2.data.vouchers.some(x => x.id === 'c'));
  assert.deepEqual([ra.inN, ra.outN, rb.inN, rb.outN], [2, 1, 1, 2]);
});

test('same record edited on both: the newer edit wins on both devices', () => {
  const A = side({ ledgers: [v('l', '2026-10-02T10:00:00.000Z', { name: 'old' })] });
  const B = side({ ledgers: [v('l', '2026-10-02T10:05:00.000Z', { name: 'newer' })] });
  const [A2, B2] = both(A, B);
  assert.equal(A2.data.ledgers[0].name, 'newer'); assert.equal(canon(A2), canon(B2));
});

test('a delete is not undone by the other device; an edit made after the delete wins', () => {
  const A = side({ vouchers: [] }, { tombstones: { vouchers: { x: '2026-10-03T00:00:00.000Z', y: '2026-10-03T00:00:00.000Z' } } });
  const B = side({ vouchers: [v('x', '2026-10-01T00:00:00.000Z'), v('y', '2026-10-04T00:00:00.000Z', { narration: 'edited later' })] });
  const [A2, B2] = both(A, B);
  assert.deepEqual(A2.data.vouchers.map(r => r.id), ['y']);
  assert.equal(canon(A2), canon(B2));
  assert.ok(A2.tombstones.vouchers.x && !A2.tombstones.vouchers.y);
});

test('a brand-new phone takes the laptop data instead of adding its own You / Spouse / demo', () => {
  const laptop = side({ entities: [v('you1', '2026-01-01T00:00:00.000Z')], vouchers: [v('v1', '2026-05-01T00:00:00.000Z')] }, { seedIds: ['you1'] });
  const phone = side({ entities: [v('you2', '2026-10-05T00:00:00.000Z')], vouchers: [v('demo1', '2026-10-05T00:00:00.000Z')] }, { pristine: true, seedIds: ['you2', 'demo1'] });
  const [L2, P2] = both(laptop, phone);
  assert.equal(canon(L2), canon(P2));
  assert.deepEqual(P2.data.entities.map(e => e.id), ['you1']);
  assert.deepEqual(P2.data.vouchers.map(e => e.id), ['v1']);
});

test('clashing entry numbers are renumbered the same way on both devices', () => {
  const list = [
    { id: 'v1', entityId: 'e', type: 'payment', date: '2026-08-01', no: 'P/2026-27/0001', createdAt: '2026-08-01T01:00:00Z' },
    { id: 'v2', entityId: 'e', type: 'payment', date: '2026-08-02', no: 'P/2026-27/0001', createdAt: '2026-08-02T01:00:00Z' },
    { id: 'v3', entityId: 'e', type: 'payment', date: '2026-08-03', no: 'P/2026-27/0002', createdAt: '2026-08-03T01:00:00Z' }];
  const ch = renumberDuplicates(list, nextNumber);
  assert.deepEqual(ch.map(x => [x.id, x.no]), [['v2', 'P/2026-27/0003']]);
  assert.deepEqual(renumberDuplicates(list.slice().reverse(), nextNumber).map(x => [x.id, x.no]), [['v2', 'P/2026-27/0003']]);
});

test('the same statement imported on both devices is spotted after sync', () => {
  const b1 = { id: 'b1', createdAt: '2026-09-01T00:00:00Z' }, b2 = { id: 'b2', createdAt: '2026-09-02T00:00:00Z' };
  const mk = (id, batchId, fp) => ({ id, entityId: 'e', batchId, fp, fpLedger: 'sbi' });
  const vs = [mk('p1', 'b1', 'f1'), mk('p2', 'b1', 'f2'), mk('q1', 'b2', 'f1'), mk('q2', 'b2', 'f2'), mk('q3', 'b2', 'f3')];
  assert.deepEqual(crossDeviceDuplicates(vs, [b1, b2]).map(x => x.id), ['q1', 'q2']);
});
