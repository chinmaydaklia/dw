/* Zerodha files, ported from DoctorWealth v11. Pure: callers pass sheet rows (arrays of arrays).
   Labels are matched by text, never by fixed cell references. */
import { toPaise } from '../lib/money.js';

function numCell(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[,\s₹]/g, '');
  if (!/^[-+(]?\d*\.?\d+\)?$/.test(s)) return null;
  const neg = /^\(.*\)$/.test(s) || s.charAt(0) === '-';
  const n = parseFloat(s.replace(/[()+-]/g, ''));
  return isNaN(n) ? null : (neg ? -n : n);
}
/* label cell; value = first numeric cell to its right, else the cell just below */
function labelValue(rows, label) {
  const L = label.toLowerCase().replace(/\s+/g, ' ');
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        const t = String(row[c] == null ? '' : row[c]).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[:.]$/, '');
        if (!t) continue;
        if (pass === 0 ? t === L : (t.indexOf(L) === 0 && t.length < L.length + 20)) {
          for (let c2 = c + 1; c2 < row.length; c2++) { const n = numCell(row[c2]); if (n !== null) return n; }
          if (rows[r + 1]) { const nb = numCell(rows[r + 1][c]); if (nb !== null) return nb; }
          return 0;
        }
      }
    }
  }
  return null;
}
export function sheetByName(sheets, name) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9&]/g, '');
  const want = norm(name);
  const names = Object.keys(sheets);
  const hit = names.find(n => norm(n) === want) || names.find(n => norm(n).includes(want));
  return hit ? sheets[hit] : [];
}

/* sheets: { sheetName: rows[][] } */
export function parseTaxPnl(sheets, fileName = '', defaultFy = '') {
  const out = { found: {}, dividendRows: 0, file: fileName };
  const eq = sheetByName(sheets, 'Equity and Non Equity');
  const fo = sheetByName(sheets, 'F&O');
  const dv = sheetByName(sheets, 'Equity Dividends');
  const lb = sheetByName(sheets, 'Ledger Balances');
  const take = (key, rows, label) => { const v = labelValue(rows, label); out.found[key] = v !== null; out[key] = v === null ? 0 : Math.round(v * 100); };
  take('stcg', eq, 'Short Term profit');
  take('ltcg', eq, 'Long Term profit');
  take('intraday', eq, 'Intraday/Speculative profit');
  take('nonEquity', eq, 'Non Equity profit');
  take('foOptions', fo, 'Options Realized Profit');
  take('foFutures', fo, 'Futures Realized Profit');
  let hdr = -1, isinCol = -1, netCol = -1;
  for (let r = 0; r < dv.length && hdr < 0; r++) {
    const row = dv[r] || [];
    for (let c = 0; c < row.length; c++) { const t = String(row[c]).toLowerCase(); if (t.replace(/\s/g, '') === 'isin') isinCol = c; if (/net\s*dividend/.test(t)) netCol = c; }
    if (isinCol >= 0 && netCol >= 0) hdr = r; else { isinCol = -1; netCol = -1; }
  }
  let divTotal = 0, nRows = 0;
  for (let r = hdr >= 0 ? hdr + 1 : 0; r < dv.length; r++) {
    const dr = dv[r] || [];
    let isin = null;
    if (isinCol >= 0) isin = String(dr[isinCol] || '');
    else for (const c of dr) if (/^INE[A-Z0-9]{9}$/i.test(String(c).replace(/\s/g, ''))) { isin = String(c); break; }
    if (!isin || !/^INE/i.test(isin.replace(/\s/g, ''))) continue;
    let v = null;
    if (netCol >= 0) v = numCell(dr[netCol]);
    else for (let c = dr.length - 1; c >= 0; c--) { v = numCell(dr[c]); if (v !== null) break; }
    if (v !== null) { divTotal += Math.round(v * 100); nRows++; }
  }
  out.dividends = divTotal; out.dividendRows = nRows; out.found.dividends = nRows > 0;
  const lc = labelValue(lb, 'Closing Balance'); out.ledgerClose = lc === null ? null : Math.round(lc * 100);
  const m = /(20\d{2})[_-](20\d{2})/.exec(fileName);
  let fy = '';
  if (m && Number(m[2]) === Number(m[1]) + 1) fy = m[1] + '-' + m[2].slice(2);
  if (!fy) { const m2 = /(20\d{2})-04-01/.exec(JSON.stringify(eq.slice(0, 15))); if (m2) fy = m2[1] + '-' + String(Number(m2[1]) + 1).slice(2); }
  out.fy = fy || defaultFy;
  if (!Object.values(out.found).some(Boolean)) out.error = 'This does not look like a Zerodha tax P&L file (sheets “Equity and Non Equity”, “F&O”, “Equity Dividends” not found). For holdings use “Zerodha holdings”.';
  return out;
}

/* Kite "Holdings" export: Symbol | ISIN | … | Quantity Available | … | Average Price | Previous Closing Price */
export function parseHoldings(rows) {
  let head = -1, col = {};
  for (let i = 0; i < rows.length && i < 80; i++) {
    const r = rows[i] || []; col = {};
    for (let c = 0; c < r.length; c++) {
      const h = String(r[c] || '').toLowerCase().trim();
      if (col.sym === undefined && (h.includes('symbol') || h.includes('instrument'))) col.sym = c;
      if (col.isin === undefined && h === 'isin') col.isin = c;
      if (h === 'qty.' || h === 'qty' || h === 'quantity' || h === 'quantity available') col.qty = c;
      else if (col.qty === undefined && (h.includes('qty') || h.includes('quantity')) && !/discrepant|pledged|long term/.test(h)) col.qty = c;
      if (col.avg === undefined && (h.includes('avg') || h.includes('average'))) col.avg = c;
      if (col.ltp === undefined && (h.includes('ltp') || h.includes('last price') || h.includes('clos'))) col.ltp = c;
      if (col.sector === undefined && h === 'sector') col.sector = c;
    }
    if (col.sym !== undefined && col.qty !== undefined) { head = i; break; }
  }
  if (head < 0) return { error: 'Could not find Symbol and Quantity columns. Use the Kite Console → Portfolio → Holdings → Download (Excel).' };
  const items = [];
  for (let k = head + 1; k < rows.length; k++) {
    const row = rows[k] || []; const name = row[col.sym];
    if (!name) continue;
    const qty = Number(String(row[col.qty]).replace(/,/g, '')) || 0;
    if (qty <= 0) continue;
    const avg = toPaise(row[col.avg]) || 0, ltp = col.ltp !== undefined ? (toPaise(row[col.ltp]) || 0) : 0;
    items.push({ symbol: String(name).trim(), isin: col.isin !== undefined ? String(row[col.isin] || '') : '', qty, avg, ltp, cost: Math.round(qty * avg), value: Math.round(qty * (ltp || avg)) });
  }
  if (!items.length) return { error: 'No holdings with quantity found in the file.' };
  return { items, cost: items.reduce((t, x) => t + x.cost, 0), value: items.reduce((t, x) => t + x.value, 0) };
}
