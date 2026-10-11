/* In-memory state backed by IndexedDB. All writes go through here so audit, numbering, validation,
   locking and persistence are applied in one place. */
import * as DB from './db.js';
import { makeEntity, seedMasters, makeLedger } from '../core/masters.js';
import { makeCtx } from '../core/books.js';
import { validateVoucher, nextNumber, newVoucher } from '../core/vouchers.js';
import { buildDemo } from '../core/demo.js';
import { uid, nowISO, clone } from '../lib/util.js';
import { today, fyOf } from '../lib/dates.js';

export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;
const COLLS = ['entities', 'groups', 'ledgers', 'vouchers', 'rules', 'recurring', 'shortcuts', 'batches', 'holdings', 'taxpnl'];

export const S = {
  entities: [], groups: [], ledgers: [], vouchers: [], rules: [], recurring: [], shortcuts: [], batches: [], holdings: [], taxpnl: [],
  settings: {}, persistence: null, version: 0
};
const DEFAULT_SETTINGS = { activeEntityId: '', theme: 'auto', hideAmounts: false, proMode: false, lastBackupAt: '', fy: fyOf(today()), owners: ['Me', 'Spouse', 'Joint'], defaultMoney: {}, lastSnapshotAt: '' };

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function changed() { S.version++; ctxCache.clear(); for (const fn of subs) { try { fn(); } catch (e) { console.error(e); } } }

/* ---------- boot ---------- */
/* Forward-only data migrations keyed by the version they upgrade FROM. A backup snapshot is taken first. */
const MIGRATIONS = {};

export async function init() {
  const [meta, ...lists] = await Promise.all([DB.getAll('meta'), ...COLLS.map(c => DB.getAll(c))]);
  COLLS.forEach((c, i) => { S[c] = lists[i]; });
  const m = Object.fromEntries(meta.map(x => [x.key, x.value]));
  S.settings = { ...DEFAULT_SETTINGS, ...(m.settings || {}) };
  let schema = m.schema || 0;
  if (!S.entities.length) { await firstRun(); schema = SCHEMA_VERSION; }
  if (schema > SCHEMA_VERSION) throw new Error(`This data was saved by a newer version of the app (schema ${schema}). Update the app before opening it.`);
  if (schema < SCHEMA_VERSION) {
    await snapshot(`Before upgrade from schema ${schema}`);
    for (let v = schema; v < SCHEMA_VERSION; v++) if (MIGRATIONS[v]) await MIGRATIONS[v]();
  }
  await DB.write([{ store: 'meta', put: { key: 'schema', value: SCHEMA_VERSION } }, { store: 'meta', put: { key: 'appVersion', value: APP_VERSION } }]);
  if (!S.entities.find(e => e.id === S.settings.activeEntityId)) S.settings.activeEntityId = S.entities[0].id;
  S.persistence = await DB.requestPersistence();
  changed();
}

async function firstRun() {
  const ops = [];
  const you = makeEntity({ name: 'You', accent: '#d9b35a', template: 'self', order: 0 });
  const sp = makeEntity({ name: 'Spouse', accent: '#5aa9e6', template: 'spouse', order: 1 });
  for (const e of [you, sp]) {
    const { groups, ledgers } = seedMasters(e);
    S.entities.push(e); S.groups.push(...groups); S.ledgers.push(...ledgers);
    ops.push({ store: 'entities', put: e }, ...groups.map(g => ({ store: 'groups', put: g })), ...ledgers.map(l => ({ store: 'ledgers', put: l })));
  }
  const demo = demoOps();
  ops.push(...demo.ops);
  S.settings.activeEntityId = demo.entity.id;
  S.settings.firstRun = true;
  ops.push({ store: 'meta', put: { key: 'settings', value: S.settings } });
  await DB.write(ops);
}
function demoOps() {
  const d = buildDemo({ upto: today() });
  numberAll(d.vouchers);
  S.entities.push(d.entity); S.groups.push(...d.groups); S.ledgers.push(...d.ledgers); S.vouchers.push(...d.vouchers);
  S.recurring.push(...d.recurring); S.rules.push(...d.rules);
  return {
    entity: d.entity,
    ops: [{ store: 'entities', put: d.entity }, ...d.groups.map(g => ({ store: 'groups', put: g })), ...d.ledgers.map(l => ({ store: 'ledgers', put: l })),
      ...d.vouchers.map(v => ({ store: 'vouchers', put: v })), ...d.recurring.map(r => ({ store: 'recurring', put: r })), ...d.rules.map(r => ({ store: 'rules', put: r }))]
  };
}
function numberAll(vouchers) {
  const sorted = vouchers.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''));
  const done = [];
  for (const v of sorted) { if (!v.no) v.no = nextNumber(done, v.entityId, v.type, v.date); done.push(v); }
}

/* ---------- reads ---------- */
export const activeEntity = () => S.entities.find(e => e.id === S.settings.activeEntityId) || S.entities[0];
export const entityById = id => S.entities.find(e => e.id === id);
export const sortedEntities = () => S.entities.slice().sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
export function dataOf(entityId) {
  return {
    entity: entityById(entityId),
    groups: S.groups.filter(g => g.entityId === entityId),
    ledgers: S.ledgers.filter(l => l.entityId === entityId),
    vouchers: S.vouchers.filter(v => v.entityId === entityId)
  };
}
const ctxCache = new Map();
export function ctxOf(entityId = S.settings.activeEntityId) {
  if (!ctxCache.has(entityId)) ctxCache.set(entityId, makeCtx(dataOf(entityId)));
  return ctxCache.get(entityId);
}
export const ctx = () => ctxOf(activeEntity().id);
export const ledger = id => S.ledgers.find(l => l.id === id);
export const voucher = id => S.vouchers.find(v => v.id === id);

/* ---------- generic write ---------- */
function auditOp(entityId, action, kind, refId, summary, before, after) {
  return { store: 'audit', put: { id: uid('aud'), entityId, at: nowISO(), action, kind, refId, summary, before: before ? clone(before) : null, after: after ? clone(after) : null } };
}
function applyMem(store, rec, del) {
  const arr = S[store]; if (!arr) return;
  const i = arr.findIndex(x => x.id === (del ? rec : rec.id));
  if (del) { if (i >= 0) arr.splice(i, 1); }
  else if (i >= 0) arr[i] = rec; else arr.push(rec);
}
export async function commit(ops) {
  await DB.write(ops);
  for (const o of ops) if (o.store !== 'audit' && o.store !== 'meta' && o.store !== 'backups') applyMem(o.store, o.del !== undefined ? o.del : o.put, o.del !== undefined);
  changed();
}

/* ---------- settings ---------- */
export async function setSettings(patch) {
  Object.assign(S.settings, patch);
  await DB.write([{ store: 'meta', put: { key: 'settings', value: S.settings } }]);
  changed();
}

/* ---------- vouchers ---------- */
export function prepareVoucher(entityId, draft) { return newVoucher(entityId, draft); }

export async function saveVoucher(v) {
  const c = ctxOf(v.entityId);
  const previous = S.vouchers.find(x => x.id === v.id) || null;
  const errs = validateVoucher(c, v, { isNew: !previous, previous });
  if (errs.length) { const e = new Error(errs.join('\n')); e.errors = errs; throw e; }
  const rec = clone(v);
  const keepNo = previous && previous.no && previous.type === rec.type && fyOf(previous.date) === fyOf(rec.date);
  rec.no = keepNo ? previous.no : nextNumber(S.vouchers, rec.entityId, rec.type, rec.date);
  rec.updatedAt = nowISO();
  await commit([{ store: 'vouchers', put: rec }, auditOp(rec.entityId, previous ? 'update' : 'create', 'voucher', rec.id, describe(rec), previous, rec)]);
  return rec;
}
export async function saveVouchers(list, extraOps = []) {
  const ops = [];
  const pool = S.vouchers.slice();
  for (const v of list) {
    const errs = validateVoucher(ctxOf(v.entityId), v);
    if (errs.length) throw new Error(`${v.date} ${v.narration || ''}: ${errs.join(' ')}`);
    v.no = nextNumber(pool, v.entityId, v.type, v.date); pool.push(v);
    ops.push({ store: 'vouchers', put: v });
  }
  await commit([...ops, ...extraOps]);
}
export async function deleteVoucher(id) {
  const v = voucher(id); if (!v) return;
  const lock = (entityById(v.entityId) || {}).lockedUpto;
  if (lock && v.date <= lock) throw new Error(`Books are locked up to ${lock}.`);
  await commit([{ store: 'vouchers', del: id }, auditOp(v.entityId, 'delete', 'voucher', id, describe(v), v, null)]);
}
export function describe(v) {
  const tot = v.lines.reduce((t, l) => t + (l.dr || 0), 0);
  return `${v.no || v.type} ${v.date} ₹${(tot / 100).toFixed(2)} ${v.narration || ''}`.trim();
}

/* ---------- masters ---------- */
export async function saveLedger(l) {
  const prev = ledger(l.id);
  l.updatedAt = nowISO();
  await commit([{ store: 'ledgers', put: clone(l) }, auditOp(l.entityId, prev ? 'update' : 'create', 'ledger', l.id, l.name, prev, l)]);
}
export function ledgerUsage(id) { return S.vouchers.filter(v => v.lines.some(x => x.ledgerId === id)).length + S.recurring.filter(r => r.template.lines.some(x => x.ledgerId === id)).length; }
export async function deleteLedger(id) {
  const l = ledger(id); if (!l) return;
  if (l.system === 'capital') throw new Error('The capital account cannot be deleted.');
  const n = ledgerUsage(id);
  if (n) throw new Error(`“${l.name}” is used in ${n} entr${n === 1 ? 'y' : 'ies'}. Archive it instead, or move those entries first.`);
  await commit([{ store: 'ledgers', del: id }, ...S.rules.filter(r => r.ledgerId === id).map(r => ({ store: 'rules', del: r.id })), auditOp(l.entityId, 'delete', 'ledger', id, l.name, l, null)]);
}
export async function saveGroup(g) { g.updatedAt = nowISO(); await commit([{ store: 'groups', put: clone(g) }]); }
export async function deleteGroup(id) {
  const g = S.groups.find(x => x.id === id);
  if (S.ledgers.some(l => l.groupId === id)) throw new Error('Move or delete the ledgers in this group first.');
  if (g && g.system) throw new Error('Built-in groups can be renamed but not deleted.');
  await commit([{ store: 'groups', del: id }]);
}

/* ---------- entities ---------- */
export async function addEntity({ name, accent, template, copyFrom }) {
  const e = makeEntity({ name, accent, template, order: S.entities.length });
  const { groups, ledgers } = seedMasters(e, template === 'blank' ? 'spouse' : template);
  let gs = groups, ls = template === 'blank' ? ledgers.filter(l => l.system) : ledgers;
  if (copyFrom) {
    const { copyMasters } = await import('../core/masters.js');
    const src = dataOf(copyFrom);
    const extra = copyMasters({ ...src, sites: src.entity.sites }, e, gs, ls);
    gs = gs.concat(extra.groups); ls = ls.concat(extra.ledgers);
  }
  await commit([{ store: 'entities', put: e }, ...gs.map(g => ({ store: 'groups', put: g })), ...ls.map(l => ({ store: 'ledgers', put: l })), auditOp(e.id, 'create', 'entity', e.id, e.name)]);
  return e;
}
export async function saveEntity(e) { e.updatedAt = nowISO(); await commit([{ store: 'entities', put: clone(e) }, auditOp(e.id, 'update', 'entity', e.id, e.name)]); }
export async function deleteEntity(id) {
  if (S.entities.length <= 1) throw new Error('At least one entity must remain.');
  const ops = [{ store: 'entities', del: id }];
  for (const c of COLLS.filter(c => c !== 'entities')) for (const r of S[c].filter(x => x.entityId === id)) ops.push({ store: c, del: r.id });
  /* inter-entity ledgers elsewhere pointing at it become ordinary ledgers */
  for (const l of S.ledgers.filter(x => x.interEntityWith === id)) ops.push({ store: 'ledgers', put: { ...l, interEntityWith: '' } });
  await snapshot('Before deleting entity ' + (entityById(id) || {}).name);
  await commit(ops);
  if (S.settings.activeEntityId === id) await setSettings({ activeEntityId: sortedEntities()[0].id });
}
export async function recreateDemo() {
  const d = demoOps();
  await DB.write(d.ops); changed();
  return d.entity;
}
export async function addInterEntityLedger(entityId, otherId) {
  const existing = S.ledgers.find(l => l.entityId === entityId && l.interEntityWith === otherId);
  if (existing) return existing;
  const g = S.groups.find(x => x.entityId === entityId && x.key === 'advances') || S.groups.find(x => x.entityId === entityId && x.root === 'asset');
  const l = makeLedger({ entityId, groupId: g.id, name: 'Current A/c – ' + entityById(otherId).name, interEntityWith: otherId });
  await saveLedger(l);
  return l;
}

/* ---------- backups ---------- */
export async function exportAll() {
  const out = { app: 'DoctorWealth Books', format: 1, schema: SCHEMA_VERSION, appVersion: APP_VERSION, exportedAt: nowISO(), settings: S.settings };
  for (const c of COLLS) out[c] = S[c];
  out.audit = await DB.getAll('audit');
  return out;
}
export function isOwnBackup(o) { return !!o && o.app === 'DoctorWealth Books' && Array.isArray(o.entities) && Array.isArray(o.vouchers); }
export async function restoreAll(o) {
  if (!isOwnBackup(o)) throw new Error('Not a DoctorWealth Books backup file.');
  if ((o.schema || 1) > SCHEMA_VERSION) throw new Error('This backup is from a newer version of the app. Update first.');
  await snapshot('Before restoring a backup');
  await DB.clearAll(['backups']);
  const ops = [];
  for (const c of COLLS) for (const r of o[c] || []) ops.push({ store: c, put: r });
  for (const a of o.audit || []) ops.push({ store: 'audit', put: a });
  ops.push({ store: 'meta', put: { key: 'settings', value: { ...DEFAULT_SETTINGS, ...(o.settings || {}) } } }, { store: 'meta', put: { key: 'schema', value: o.schema || 1 } });
  await DB.write(ops);
  await init();
}
/* internal snapshot kept on this device (last 5), taken before upgrades, restores and deletions */
export async function snapshot(reason) {
  const data = await exportAll();
  const rec = { id: uid('bak'), at: nowISO(), reason, size: JSON.stringify(data).length, data };
  const all = (await DB.getAll('backups')).sort((a, b) => b.at.localeCompare(a.at));
  const ops = [{ store: 'backups', put: rec }, ...all.slice(4).map(b => ({ store: 'backups', del: b.id }))];
  await DB.write(ops);
  S.settings.lastSnapshotAt = rec.at;
}
export const listSnapshots = async () => (await DB.getAll('backups')).sort((a, b) => b.at.localeCompare(a.at));
export const listAudit = async () => (await DB.getAll('audit')).sort((a, b) => b.at.localeCompare(a.at));
