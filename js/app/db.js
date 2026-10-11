/* Thin IndexedDB wrapper. One database, one object store per collection, all keyed by id. */
export const DB_NAME = 'doctorwealth-books';
export const IDB_VERSION = 1;
export const STORES = ['meta', 'entities', 'groups', 'ledgers', 'vouchers', 'audit', 'rules', 'recurring', 'shortcuts', 'batches', 'holdings', 'taxpnl', 'backups'];
const BY_ENTITY = ['groups', 'ledgers', 'vouchers', 'audit', 'rules', 'recurring', 'shortcuts', 'batches', 'holdings', 'taxpnl'];

let dbp = null;
export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (db.objectStoreNames.contains(s)) continue;
        const os = db.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' });
        if (BY_ENTITY.includes(s)) os.createIndex('entityId', 'entityId');
      }
    };
    req.onsuccess = () => { const db = req.result; db.onversionchange = () => db.close(); resolve(db); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The database is open in another tab with an older version. Close other tabs and reload.'));
  });
  return dbp;
}
const done = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Transaction aborted')); });
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function getAll(store) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).getAll());
}
export async function get(store, key) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).get(key));
}
/* ops: [{ store, put: rec } | { store, del: id }] — applied atomically */
export async function write(ops) {
  if (!ops.length) return;
  const db = await openDB();
  const stores = [...new Set(ops.map(o => o.store))];
  const tx = db.transaction(stores, 'readwrite');
  for (const o of ops) {
    const os = tx.objectStore(o.store);
    if (o.del !== undefined) os.delete(o.del); else os.put(o.put);
  }
  return done(tx);
}
export async function clearAll(except = []) {
  const db = await openDB();
  const stores = STORES.filter(s => !except.includes(s));
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) tx.objectStore(s).clear();
  return done(tx);
}
export async function requestPersistence() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return { supported: false };
    const already = await navigator.storage.persisted();
    const granted = already || await navigator.storage.persist();
    const est = navigator.storage.estimate ? await navigator.storage.estimate() : {};
    return { supported: true, granted, usage: est.usage || 0, quota: est.quota || 0 };
  } catch (e) { return { supported: false, error: String(e) }; }
}
