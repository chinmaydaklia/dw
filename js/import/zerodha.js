/* Zerodha files, ported from DoctorWealth v11. Pure: callers pass sheet rows (arrays of arrays).
   Labels are matched by text, never by fixed cell references. */
import { toPaise } from '../lib/money.js';
import { parseDateAny } from '../lib/dates.js';

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

/* ---------- Zerodha DP "Transaction with Holding Statement" (PDF) ----------
   pages: output of groupPdfItems per page. Reads the "Holdings as on <date>" table:
   ISIN Code | Company Name (often wrapped onto lines above/below) | Curr. Bal | Free Bal | … | Rate | Value.
   The DP statement has no buy price, so cost is unknown (noCost: true; avg = today's rate). */
const ISIN_RE = /^IN[EF0-9][A-Z0-9]{9}$/;
export function holdingKey(n) {
  return String(n || '').toUpperCase().replace(/\(.*?\)/g, '').replace(/\s*-\s*EQ.*$/, '').replace(/\s+EQ\b.*$/, '').replace(/-\s*(RS\.?\s*)?\d+\/-?$/, '').replace(/\b(LTD|LIMITED)\b/g, '').replace(/[^A-Z0-9]/g, '');
}
export function parseDpHoldings(pages) {
  const rows = [], texts = [];
  let asOf = '', started = false;
  pages.forEach((lines, p) => {
    for (const L of lines) {
      const cells = L.cells, txt = cells.map(c => c.t).join(' ');
      const m = /holdings as on\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\w{2,3}[/-]\d{2,4})/i.exec(txt);
      if (m) { started = true; asOf = parseDateAny(m[1]); continue; }
      if (!started) continue;
      if (/^total\b/i.test(txt.replace(/^\W+/, ''))) { started = false; continue; }
      if (/isin code|company name/i.test(txt)) continue;
      if (ISIN_RE.test(cells[0].t)) {
        const nums = [], name = [];
        for (const c of cells.slice(1)) { if (/^-?\d[\d,]*(\.\d+)?$/.test(c.t)) nums.push(parseFloat(c.t.replace(/,/g, ''))); else name.push(c.t); }
        if (nums.length < 3) continue;
        rows.push({ isin: cells[0].t, parts: name, qty: nums[0], rate: nums[nums.length - 2], value: nums[nums.length - 1], y: L.y, page: p, h: L.h || 6, above: [], below: [] });
      } else if (!/^[\d.,\s]+$/.test(txt)) texts.push({ t: txt, y: L.y, page: p, h: L.h || 6 });
    }
  });
  /* wrapped company names sit above and below their row: each text line goes to the nearest row on its page */
  for (const tl of texts) {
    let best = null, bd = 1e9;
    for (const r of rows) { if (r.page !== tl.page) continue; const d = Math.abs(r.y - tl.y); if (d < bd) { bd = d; best = r; } }
    if (best && bd <= tl.h * 2.6) (tl.y > best.y ? best.above : best.below).push(tl);
  }
  const items = rows.map(r => {
    const parts = [...r.above.sort((a, b) => b.y - a.y).map(x => x.t), ...r.parts, ...r.below.sort((a, b) => b.y - a.y).map(x => x.t)];
    let name = '';
    for (const pt of parts.map(x => x.trim()).filter(Boolean)) name += (!name ? '' : (/-$/.test(name) || /^\//.test(pt) ? '' : ' ')) + pt;
    const ltp = Math.round(r.rate * 100), value = Math.round(r.value * 100);
    return { symbol: holdingKey(name) || r.isin, name: name.replace(/\s+/g, ' '), isin: r.isin, qty: r.qty, avg: ltp, ltp, cost: value, value, noCost: true };
  });
  if (!items.length) return { error: 'No “Holdings as on …” table found. Use the Zerodha DP “Transaction with Holding Statement” PDF, or the Kite holdings Excel.' };
  return { items, asOf, cost: items.reduce((t, x) => t + x.cost, 0), value: items.reduce((t, x) => t + x.value, 0), source: 'dp' };
}

/* ---------- Tax P&L "Tradewise Exits" sheet: one row per closed trade, grouped in sections ----------
   Sections: Equity - Intraday / Short Term / Long Term / Buyback, Non Equity, Mutual Funds, F&O, Currency, Commodity.
   Header: Symbol | ISIN | Entry Date | Exit Date | Quantity | Buy Value | Sell Value | Profit | Period of Holding |
           Fair Market Value | Taxable Profit | Turnover | Brokerage | … charges … | STT */
const SECTION_KIND = [
  [/intraday|speculat/i, 'intraday'], [/buy ?back/i, 'buyback'], [/short/i, 'short'], [/long/i, 'long'],
  [/non[\s-]*equity/i, 'nonequity'], [/mutual/i, 'mf'], [/f\s*&\s*o|futures|options|derivative/i, 'fo'], [/currency/i, 'currency'], [/commodit/i, 'commodity']
];
export const DELIVERY_KINDS = new Set(['short', 'long', 'buyback', 'nonequity', 'mf']);
const norm = v => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();
function headerMap(row) {
  const m = {};
  row.forEach((c, i) => {
    const t = norm(c);
    if (!t) return;
    if (t === 'symbol' || t === 'scrip' || t === 'instrument') m.symbol = i;
    else if (t === 'isin') m.isin = i;
    else if (/^entry date|^buy date/.test(t)) m.entry = i;
    else if (/^exit date|^sell date/.test(t)) m.exit = i;
    else if (/^quantity|^qty/.test(t)) m.qty = i;
    else if (/^buy value/.test(t)) m.buy = i;
    else if (/^sell value/.test(t)) m.sell = i;
    else if (t === 'profit' || /^realized p&l$|^realised p&l$|^p&l$/.test(t)) m.profit = i;
    else if (/period of holding/.test(t)) m.days = i;
    else if (/fair market value/.test(t)) m.fmv = i;
    else if (/taxable profit/.test(t)) m.taxable = i;
    else if (t === 'turnover') m.turnover = i;
    else if (t === 'stt' || /securities transaction/.test(t)) m.stt = i;
    else if (/brokerage|exchange transaction|ipft|sebi|gst|stamp/.test(t)) (m.charges = m.charges || []).push(i);
  });
  return m;
}
const money = v => { const n = numCell(v); return n === null ? 0 : Math.round(n * 100); };
export function parseTradewise(sheets, parseDate) {
  const name = Object.keys(sheets).find(n => /tradewise|trade ?wise|exits/i.test(n));
  if (!name) return { error: 'No “Tradewise Exits” sheet in this file.' };
  const rows = sheets[name];
  const out = [];
  let kind = '', head = null;
  for (const r of rows) {
    const cells = (r || []).map(norm);
    const filled = cells.filter(Boolean);
    if (!filled.length) { head = null; continue; }
    const h = headerMap(r);
    if (h.symbol !== undefined && (h.exit !== undefined || h.sell !== undefined) && h.qty !== undefined) { head = h; continue; }
    /* a section title: a short text-only row such as "Equity - Long Term" */
    const sec = filled.length <= 2 && !filled.some(c => numCell(c) !== null) ? SECTION_KIND.find(([re]) => re.test(filled.join(' '))) : null;
    if (sec) { kind = sec[1]; head = null; continue; }
    if (!head) continue;
    const sym = String(r[head.symbol] == null ? '' : r[head.symbol]).trim();
    const qty = numCell(r[head.qty]);
    if (!sym || qty === null || /^total/i.test(sym)) continue;
    const charges = (head.charges || []).reduce((t, i) => t + money(r[i]), 0);
    out.push({
      kind: kind || 'short', symbol: sym, isin: head.isin !== undefined ? String(r[head.isin] || '').trim() : '',
      entry: head.entry !== undefined ? parseDate(r[head.entry]) : '', exit: head.exit !== undefined ? parseDate(r[head.exit]) : '',
      qty: Math.abs(qty), buy: Math.abs(money(r[head.buy])), sell: Math.abs(money(r[head.sell])), profit: head.profit !== undefined ? money(r[head.profit]) : money(r[head.sell]) - money(r[head.buy]),
      days: head.days !== undefined ? numCell(r[head.days]) : null, fmv: head.fmv !== undefined ? money(r[head.fmv]) : 0,
      turnover: head.turnover !== undefined ? Math.abs(money(r[head.turnover])) : 0, charges, stt: head.stt !== undefined ? money(r[head.stt]) : 0
    });
  }
  if (!out.length) return { error: 'The Tradewise Exits sheet has no trades.' };
  return { rows: out, sheet: name };
}

/* ---------- Console P&L export (no trade dates): symbol-wise realised P&L plus a charges summary ---------- */
export function parseConsolePnl(sheets, fileName = '') {
  for (const [name, rows] of Object.entries(sheets)) {
    const hi = rows.findIndex(r => { const h = headerMap(r || []); return h.symbol !== undefined && h.profit !== undefined && h.buy !== undefined; });
    if (hi < 0) continue;
    const h = headerMap(rows[hi]);
    const items = [];
    for (const r of rows.slice(hi + 1)) {
      const sym = String((r || [])[h.symbol] == null ? '' : r[h.symbol]).trim();
      if (!sym || /^total/i.test(sym)) continue;
      const pl = numCell(r[h.profit]); if (pl === null) continue;
      items.push({ symbol: sym, isin: h.isin !== undefined ? String(r[h.isin] || '') : '', qty: numCell(r[h.qty]) || 0, buy: money(r[h.buy]), sell: money(r[h.sell]), profit: Math.round(pl * 100) });
    }
    /* charges summary block above the table: "Charges" label with a number beside it */
    let charges = 0;
    for (const r of rows.slice(0, hi)) { const t = norm((r || [])[0]); if (/^charges$|total charges/.test(t)) { const n = (r || []).slice(1).map(numCell).find(x => x !== null); if (n !== null && n !== undefined) charges = Math.round(n * 100); } }
    const text = (name + ' ' + fileName + ' ' + JSON.stringify(rows.slice(0, hi))).toLowerCase();
    const segment = /f\s*&\s*o|fno|derivative|futures|options/.test(text) ? 'fo' : /intraday/.test(text) ? 'intraday' : 'equity';
    return { items, charges, segment, sheet: name };
  }
  return { error: 'Could not find the Symbol / Buy Value / Realized P&L table.' };
}
