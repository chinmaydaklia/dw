/* Phone ⇄ laptop sync: merge two copies of the books record by record. Pure (no DOM, no storage).
   - Every record carries updatedAt (a hybrid clock that never runs backwards); the newer edit of a record wins.
   - Deletions leave a tombstone { store: { id: time } }, so a delete on one device is not undone by the other.
   - A brand-new device (only its own starter data, untouched) takes the other device's data instead of adding
     a second "You", "Spouse" and demo.
   Settings, the change history (audit) and on-device snapshots never sync. */

export const SYNC_STORES = ['entities', 'groups', 'ledgers', 'vouchers', 'rules', 'recurring', 'shortcuts', 'batches', 'holdings', 'taxpnl', 'assets'];
export const stampOf = r => (r && (r.updatedAt || r.createdAt)) || '';

/* deterministic: both devices pick the same winner even when the times are equal */
function newer(a, b) {
  if (!a) return b; if (!b) return a;
  const ta = stampOf(a), tb = stampOf(b);
  if (ta > tb) return a; if (tb > ta) return b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

/* side: { data: { store: [records] }, tombstones, pristine, seedIds: [] }
   Returns what THIS device must write, plus counts for the "N in, M out" line. */
export function mergeSync(local, remote) {
  const lSeed = new Set(local.seedIds || []), rSeed = new Set(remote.seedIds || []);
  /* a fresh device yields to a used one; if both are fresh nothing is dropped */
  const dropLocalSeeds = !!local.pristine && !remote.pristine;
  const skipRemoteSeeds = !!remote.pristine && !local.pristine;
  const out = { puts: {}, dels: {}, tombstones: {}, inN: 0, outN: 0, maxStamp: '' };
  const seen = t => { if (t > out.maxStamp) out.maxStamp = t; };
  for (const store of SYNC_STORES) {
    const la = (local.data && local.data[store]) || [], ra = (remote.data && remote.data[store]) || [];
    const lt = (local.tombstones && local.tombstones[store]) || {}, rt = (remote.tombstones && remote.tombstones[store]) || {};
    const tomb = { ...lt };
    for (const [id, t] of Object.entries(rt)) { if (!tomb[id] || t > tomb[id]) tomb[id] = t; seen(t); }
    const lm = new Map(la.map(r => [r.id, r])), rm = new Map(ra.map(r => [r.id, r]));
    const puts = [], dels = [];
    for (const id of new Set([...lm.keys(), ...rm.keys()])) {
      let l = lm.get(id), r = rm.get(id);
      if (l && dropLocalSeeds && lSeed.has(id) && !r) { dels.push(id); out.inN++; continue; }
      if (r && skipRemoteSeeds && rSeed.has(id) && !l) { out.outN++; continue; }
      const w = newer(l, r), wt = stampOf(w);
      seen(wt);
      if (tomb[id] && tomb[id] >= wt) {            /* deleted after its last edit: stays deleted */
        if (l) { dels.push(id); out.inN++; }
        if (r) out.outN++;
        continue;
      }
      if (tomb[id]) delete tomb[id];                /* edited after the delete: the edit wins */
      const wj = JSON.stringify(w);
      if (!l || JSON.stringify(l) !== wj) { puts.push(w); out.inN++; }
      if (!r || JSON.stringify(r) !== wj) out.outN++;
    }
    if (puts.length) out.puts[store] = puts;
    if (dels.length) out.dels[store] = dels;
    if (Object.keys(tomb).length) out.tombstones[store] = tomb;
  }
  return out;
}

/* Two devices can hand out the same entry number (R/2026-27/0007) before they sync. Keep the earliest, renumber the rest.
   Same input -> same output on both devices. nextNumber is passed in (from core/vouchers.js). */
export function renumberDuplicates(vouchers, nextNumber) {
  const byNo = new Map();
  for (const v of vouchers) { if (!v.no) continue; const k = v.entityId + '|' + v.no; if (!byNo.has(k)) byNo.set(k, []); byNo.get(k).push(v); }
  const changed = [], pool = vouchers.slice();
  for (const k of [...byNo.keys()].sort()) {
    const list = byNo.get(k); if (list.length < 2) continue;
    list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id));
    for (const v of list.slice(1)) {
      const nv = { ...v, no: nextNumber(pool, v.entityId, v.type, v.date) };
      const i = pool.indexOf(v); pool[i] = nv;
      changed.push(nv);
    }
  }
  return changed;
}

/* The same bank statement imported on BOTH devices before they synced gives two sets of identical entries
   (same statement fingerprint) from different imports. Returns the later copies, at most as many as the first import has. */
export function crossDeviceDuplicates(vouchers, batches) {
  const when = new Map(batches.map(b => [b.id, b.createdAt || '']));
  const groups = new Map();
  for (const v of vouchers) {
    if (!v.fp || !v.batchId) continue;
    const k = [v.entityId, v.fpLedger || '', v.fp].join('|');
    if (!groups.has(k)) groups.set(k, new Map());
    const g = groups.get(k); if (!g.has(v.batchId)) g.set(v.batchId, []); g.get(v.batchId).push(v);
  }
  const extra = [];
  for (const g of groups.values()) {
    if (g.size < 2) continue;
    const order = [...g.keys()].sort((a, b) => (when.get(a) || '').localeCompare(when.get(b) || '') || a.localeCompare(b));
    const keep = g.get(order[0]).length;
    for (const bid of order.slice(1)) extra.push(...g.get(bid).slice(0, keep));
  }
  return extra;
}
