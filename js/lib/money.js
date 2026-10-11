/* Money is always an integer number of paise (₹1 = 100). Never store floats. */

/* Parse user or file input into paise. Accepts "1,23,456.78", "₹ 500", "-12.5", "(250.00)", 1234.5.
   Shorthand: "12k" = 12,000, "1.5l" / "1.5L" = 1,50,000, "2cr" = 2,00,00,000.
   Returns null for anything that is not a number. String arithmetic avoids float drift. */
export function toPaise(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : null;
  let s = String(v).trim().replace(/[₹,\s]/g, '').replace(/^(rs\.?|inr)/i, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s[0] === '-') { neg = !neg; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
  let mult = 1;
  const suf = /(k|l|lac|lakh|cr|crore)$/i.exec(s);
  if (suf) {
    const u = suf[1].toLowerCase();
    mult = u === 'k' ? 1e3 : (u[0] === 'l' ? 1e5 : 1e7);
    s = s.slice(0, suf.index);
  }
  if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.$/.test(s)) return null;
  const [ip, fp = ''] = s.split('.');
  if (mult === 1) {
    const frac = (fp + '00').slice(0, 2);
    const extra = fp.length > 2 && Number(fp[2]) >= 5 ? 1 : 0;
    const p = Number(ip || '0') * 100 + Number(frac) + extra;
    return neg ? -p : p;
  }
  const p = Math.round(Number(ip + '.' + (fp || '0')) * mult * 100);
  return neg ? -p : p;
}

/* Indian digit grouping: 12345678 -> "1,23,45,678" */
export function groupIndian(intStr) {
  if (intStr.length <= 3) return intStr;
  const last3 = intStr.slice(-3);
  let rest = intStr.slice(0, -3);
  const parts = [];
  while (rest.length > 2) { parts.unshift(rest.slice(-2)); rest = rest.slice(0, -2); }
  if (rest) parts.unshift(rest);
  return parts.join(',') + ',' + last3;
}

/* Format paise. opts: { sym:true, dec:true|false|'auto', sign:false (force +/−) } */
export function formatINR(paise, opts = {}) {
  const { sym = true, dec = 'auto', sign = false } = opts;
  const p = Math.round(Number(paise) || 0);
  const neg = p < 0;
  const abs = Math.abs(p);
  const rupees = Math.floor(abs / 100);
  const ps = abs % 100;
  const showDec = dec === true || (dec === 'auto' && ps !== 0);
  let out = groupIndian(String(rupees)) + (showDec ? '.' + String(ps).padStart(2, '0') : '');
  if (sym) out = '₹' + out;
  if (neg) out = '−' + out;
  else if (sign && p > 0) out = '+' + out;
  return out;
}

/* Compact lakh/crore form for dashboards: ₹4.25 L, ₹1.2 Cr, ₹85,000 */
export function formatCompact(paise) {
  const p = Math.round(Number(paise) || 0);
  const neg = p < 0;
  const r = Math.abs(p) / 100;
  let s;
  if (r >= 1e7) s = trim(r / 1e7) + ' Cr';
  else if (r >= 1e5) s = trim(r / 1e5) + ' L';
  else s = groupIndian(String(Math.round(r)));
  return (neg ? '−' : '') + '₹' + s;
}
function trim(n) { return (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, ''); }

/* paise -> plain "1234.50" for inputs and CSV */
export function toRupeeString(paise) {
  const p = Math.round(Number(paise) || 0);
  const neg = p < 0, a = Math.abs(p);
  return (neg ? '-' : '') + Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0');
}

/* Percentage of an amount, rounded to the nearest paisa. rateBps: 1000 = 10% */
export function pctOf(paise, rateBps) { return Math.round((paise * rateBps) / 10000); }
