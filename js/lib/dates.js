/* Dates are plain "YYYY-MM-DD" strings (local calendar day), compared lexically. No timezone shifts. */

export const pad = n => String(n).padStart(2, '0');

export function today() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
export function isDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}
export function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

/* Indian financial year (1 Apr – 31 Mar). "2026-27" */
export function fyOf(date) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const s = m >= 4 ? y : y - 1;
  return s + '-' + String(s + 1).slice(2);
}
export function fyRange(fy) {
  const s = Number(fy.slice(0, 4));
  return { from: s + '-04-01', to: (s + 1) + '-03-31' };
}
export function fyShift(fy, n) {
  const s = Number(fy.slice(0, 4)) + n;
  return s + '-' + String(s + 1).slice(2);
}
export function fyList(back = 5, fwd = 1, around = fyOf(today())) {
  const out = [];
  for (let i = fwd; i >= -back; i--) out.push(fyShift(around, i));
  return out;
}
/* Tax year label used by the Income-tax Act, 2025 for the same period ("Tax year 2026-27"). */
export const taxYearOf = fyOf;

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
}
/* Add months, clamping the day to the month's length; keepDay lets "31st" recover in longer months. */
export function addMonths(date, n, keepDay) {
  let [y, m, d] = date.split('-').map(Number);
  const want = keepDay || d;
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return y + '-' + pad(m) + '-' + pad(Math.min(want, daysInMonth(y, m)));
}
export function monthEnd(date) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  return date.slice(0, 8) + pad(daysInMonth(y, m));
}
export function monthKey(date) { return date.slice(0, 7); }
/* list of "YYYY-MM" from a range */
export function monthsBetween(from, to) {
  const out = [];
  let k = from.slice(0, 7);
  const end = to.slice(0, 7);
  while (k <= end) {
    out.push(k);
    let [y, m] = k.split('-').map(Number);
    m++; if (m > 12) { m = 1; y++; }
    k = y + '-' + pad(m);
  }
  return out;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(date) {
  if (!date) return '';
  return Number(date.slice(8, 10)) + ' ' + MON[Number(date.slice(5, 7)) - 1] + ' ' + date.slice(0, 4);
}
export function fmtMonth(key) { return MON[Number(key.slice(5, 7)) - 1] + ' ' + key.slice(2, 4); }

export const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};
export function ymd(y, m, d) {
  y = parseInt(y, 10); m = parseInt(m, 10); d = parseInt(d, 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return '';
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || y < 1990 || y > 2100) return '';
  if (d > daysInMonth(y, m)) return '';
  return y + '-' + pad(m) + '-' + pad(d);
}
/* Excel serial date -> YYYY-MM-DD with UTC math */
export function excelSerialToDate(n) {
  if (typeof n !== 'number' || n < 20000 || n > 80000) return '';
  const t = new Date(Math.round((n - 25569) * 864e5));
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
}
/* Day-first parsing (Indian statements). DD/MM/YYYY, DD-MM-YY, DD.MM.YYYY, DD-MMM-YYYY, DD MMM YY, YYYY-MM-DD, MMM DD, YYYY */
export function parseDateAny(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return excelSerialToDate(v);
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
  }
  const s = String(v).trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(s))) return ymd(m[1], m[2], m[3]);
  if ((m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})(?!\d)/.exec(s))) return ymd(m[3], m[2], m[1]);
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*([A-Za-z]{3,9})[\s\-/.,']*(\d{4}|\d{2})(?!\d)/.exec(s))) {
    const mo = MONTHS[m[2].toLowerCase()]; return mo ? ymd(m[3], mo, m[1]) : '';
  }
  if ((m = /^([A-Za-z]{3,9})[\s\-.]+(\d{1,2}),?[\s\-.]+(\d{4})(?!\d)/.exec(s))) {
    const mo = MONTHS[m[1].toLowerCase()]; return mo ? ymd(m[3], mo, m[2]) : '';
  }
  return '';
}
