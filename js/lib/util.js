/* Small shared helpers. No DOM here so core modules stay testable in Node. */

export function uid(prefix = 'id') {
  const c = globalThis.crypto;
  const r = c && c.randomUUID ? c.randomUUID().replace(/-/g, '').slice(0, 16)
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return prefix + '_' + r;
}
export const nowISO = () => new Date().toISOString();
export const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
export const sum = (arr, f = x => x) => arr.reduce((t, x) => t + (f(x) || 0), 0);
export function indexBy(arr, key = 'id') { const m = new Map(); for (const x of arr) m.set(x[key], x); return m; }
export function groupBy(arr, f) {
  const m = new Map();
  for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* Narration normalisation for duplicate detection and rules: lowercase, punctuation -> space,
   drop tokens with 4+ digits (reference / UTR numbers change between exports). */
export function normNarr(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(t => t && !/\d{4,}/.test(t)).join(' ');
}
/* FNV-1a with exact 32-bit multiply: identical on every browser so fingerprints match across devices */
function mul32(a, b) { return ((((a & 0xffff) * b) + ((((a >>> 16) * b) & 0xffff) * 65536)) >>> 0); }
function hash32(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) { h = (h ^ str.charCodeAt(i)) >>> 0; h = mul32(h, 16777619); }
  return ('0000000' + h.toString(16)).slice(-8);
}
export function hashStr(str) { return hash32(str, 2166136261) + hash32(str, 0x9747b28c); }
/* signedPaise: money out of the account is negative */
export function fingerprint(ledgerId, date, signedPaise, narration) {
  return 'fp1_' + hashStr([ledgerId || '', date || '', String(Math.round(signedPaise)), normNarr(narration)].join('|'));
}

/* Deterministic PRNG for demo data */
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCSV(rows) { return rows.map(r => r.map(csvEscape).join(',')).join('\r\n'); }
