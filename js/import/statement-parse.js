/* Bank statement parsing, ported from DoctorWealth v11 and kept pure (no DOM, no libraries).
   CSV text, spreadsheet rows (from SheetJS) and PDF text items (from pdf.js) all end in finalizeTxns().
   All dates are parsed day-first (Indian statements); amounts are integer paise. */
import { parseDateAny } from '../lib/dates.js';
import { toPaise } from '../lib/money.js';

/* strict statement amount: 1,23,456.78 with optional Cr/Dr (PDF text) */
const AMT_RE = /^[-+]?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}(?:\s*\(?(?:cr|dr)\)?\.?)?$/i;

function amtWithSide(s) {
  s = String(s).trim();
  let side = '';
  const m = /\(?\b(cr|dr)\)?\.?$/i.exec(s);
  if (m) { side = m[1].toLowerCase(); s = s.slice(0, m.index); }
  return { p: toPaise(s) || 0, side };
}
/* table cell -> paise or null (empty / dash / text) */
export function cellAmount(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : null;
  const s = String(v).trim();
  if (s === '' || s === '-' || s === '--' || /^n\/?a$/i.test(s)) return null;
  const t = s.replace(/\(?\b(cr|dr)\)?\.?$/i, '').replace(/[,\s₹]/g, '').replace(/^(rs\.?|inr)/i, '');
  if (!/^[-+(]?\d*\.?\d+\)?$/.test(t)) return null;
  return amtWithSide(s).p;
}
function cellSide(v) { const m = /\b(cr|dr)\)?\.?\s*$/i.exec(String(v == null ? '' : v)); return m ? m[1].toLowerCase() : ''; }

/* header keyword classification shared by table + PDF parsers */
export function headerKind(t) {
  t = String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (/value\s*(date|dt)/.test(t)) return 'vdate';
  if (/balance|closing bal|bal\.? ?\(/.test(t)) return 'bal';
  if (/withdrawal|debit|paid out|^dr\b|\(dr\)|dr\.? amount|amount dr/.test(t)) return 'debit';
  if (/deposit|credit|paid in|^cr\b|\(cr\)|cr\.? amount|amount cr/.test(t)) return 'credit';
  if (/^(txn|tran|trans|transaction|posting|post|book)?\.?\s*(date|dt)\b|^date$/.test(t)) return 'date';
  if (/narration|description|particulars|remarks|details|transaction details/.test(t)) return 'narr';
  if (/chq|cheque|ref|instrument|utr/.test(t)) return 'ref';
  if (/^(dr\s*\/\s*cr|cr\s*\/\s*dr|type|txn type)$/.test(t)) return 'drcr';
  if (/^amount|amount \(inr\)|amount\(inr\)|^amt/.test(t)) return 'amount';
  return '';
}
export function detectBank(text) {
  const t = String(text || '').toLowerCase();
  if (/state bank of india|\bsbi\b|sbin0/.test(t)) return 'sbi';
  if (/bank of baroda|barb0|\bbob\b/.test(t)) return 'bob';
  if (/hdfc bank|hdfc0/.test(t)) return 'hdfc';
  if (/idfc first|idfc bank|idfb0/.test(t)) return 'idfc';
  if (/icici bank|icic0/.test(t)) return 'icici';
  if (/kotak mahindra|kkbk0/.test(t)) return 'kotak';
  if (/bank of india|bkid0/.test(t)) return 'boi';
  return 'generic';
}
export const BANK_NAMES = { auto: 'Auto-detect', sbi: 'SBI', bob: 'Bank of Baroda', hdfc: 'HDFC Bank', idfc: 'IDFC FIRST', icici: 'ICICI Bank', kotak: 'Kotak', boi: 'Bank of India', generic: 'Generic (columns)' };

/* ---- CSV (no library) ---- */
export function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = String(text).replace(/^﻿/, '');
  let delim = ','; const first = text.split(/\r?\n/)[0] || '';
  if (first.split('\t').length > first.split(',').length) delim = '\t';
  else if (first.split(';').length > first.split(',').length) delim = ';';
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (q) { if (c === '"') { if (text.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text.charAt(i + 1) === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/* ---- table statements (CSV / XLS / XLSX): column based ---- */
function findTableHeader(rows) {
  for (let i = 0; i < rows.length && i < 80; i++) {
    const r = rows[i] || [], col = {};
    for (let c = 0; c < r.length; c++) { const k = headerKind(r[c]); if (k && col[k] === undefined) col[k] = c; }
    if (col.date !== undefined && (col.debit !== undefined || col.credit !== undefined || col.amount !== undefined)) return { row: i, col };
  }
  return null;
}
function lastNumberIn(r) {
  for (let c = r.length - 1; c >= 0; c--) { let a = cellAmount(r[c]); if (a !== null) { if (cellSide(r[c]) === 'dr') a = -Math.abs(a); return a; } }
  return null;
}
export function parseTableStatement(rows) {
  const h = findTableHeader(rows);
  if (!h) return { error: "Couldn't find the column headers (Date, Narration, Debit/Withdrawal, Credit/Deposit, Balance)." };
  const col = h.col, txns = [], meta = { opening: null, closing: null };
  let allText = '';
  for (let i = 0; i < h.row; i++) allText += ' ' + (rows[i] || []).join(' ');
  for (let i = h.row + 1; i < rows.length; i++) {
    const r = rows[i] || []; const line = r.join(' ');
    if (!String(line).replace(/\s/g, '')) continue;
    const date = parseDateAny(r[col.date]);
    if (!date) {
      const lt = line.toLowerCase();
      if (/opening\s*bal|balance\s*b\/?f|brought forward/.test(lt)) { const oa = lastNumberIn(r); if (oa !== null && meta.opening === null) meta.opening = oa; continue; }
      if (/closing\s*bal|balance\s*c\/?f|carried forward/.test(lt)) { const ca = lastNumberIn(r); if (ca !== null) meta.closing = ca; continue; }
      /* wrapped narration line */
      if (txns.length && col.narr !== undefined && r[col.narr] && cellAmount(r[col.debit]) === null && cellAmount(r[col.credit]) === null && cellAmount(r[col.amount]) === null)
        txns[txns.length - 1].narration += ' ' + String(r[col.narr]).trim();
      continue;
    }
    const t = { date, narration: '', debit: 0, credit: 0, balance: null, hint: '' };
    if (col.narr !== undefined) t.narration = String(r[col.narr] == null ? '' : r[col.narr]).replace(/\s+/g, ' ').trim();
    else {
      const parts = [];
      for (let c = 0; c < r.length; c++) {
        if ([col.date, col.debit, col.credit, col.bal, col.amount, col.vdate].includes(c)) continue;
        if (r[c] !== '' && r[c] != null && typeof r[c] !== 'number') parts.push(String(r[c]));
      }
      t.narration = parts.join(' ');
    }
    if (col.ref !== undefined && r[col.ref] != null && String(r[col.ref]).replace(/\s/g, '')) t.ref = String(r[col.ref]).trim();
    const d = col.debit !== undefined ? cellAmount(r[col.debit]) : null, cr = col.credit !== undefined ? cellAmount(r[col.credit]) : null;
    if (d !== null && d !== 0) t.debit = Math.abs(d);
    if (cr !== null && cr !== 0) t.credit = Math.abs(cr);
    if (!t.debit && !t.credit && col.amount !== undefined) {
      const a = cellAmount(r[col.amount]);
      if (a !== null && a !== 0) {
        const side = col.drcr !== undefined ? String(r[col.drcr] || '').toLowerCase() : cellSide(r[col.amount]);
        if (/^d|debit|withdraw/.test(side) || (side === '' && a < 0)) t.debit = Math.abs(a);
        else if (/^c|credit|deposit/.test(side) || a > 0) t.credit = Math.abs(a);
      }
    }
    if (col.bal !== undefined) { let b = cellAmount(r[col.bal]); if (b !== null) { if (cellSide(r[col.bal]) === 'dr') b = -Math.abs(b); t.balance = b; } }
    if (!t.debit && !t.credit) {
      /* dated "Opening balance" row carrying only a balance */
      if (!txns.length && t.balance !== null && meta.opening === null && /open|b\/?f|brought/i.test(t.narration)) meta.opening = t.balance;
      continue;
    }
    t.hint = t.debit ? 'debit' : 'credit';
    txns.push(t);
  }
  return finalizeTxns(txns, meta, detectBank(allText + ' ' + rows.slice(0, 5).join(' ')));
}

/* ---- PDF: text items -> lines of cells (x positions kept) ---- */
export function groupPdfItems(items) {
  const its = [];
  for (const it of items) {
    if (!it || it.str === undefined) continue;
    const tr = it.transform || [1, 0, 0, 1, 0, 0]; const fh = Math.abs(tr[3]) || Math.abs(tr[0]) || 8;
    its.push({ s: it.str, x: tr[4], y: tr[5], w: it.width || 0, h: fh });
  }
  its.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = []; let cur = null;
  for (const o of its) {
    if (!cur || Math.abs(cur.y - o.y) > Math.max(2, Math.min(cur.h, o.h) * 0.45)) { cur = { y: o.y, h: o.h, items: [] }; lines.push(cur); }
    cur.items.push(o);
  }
  const out = [];
  for (const L of lines) {
    L.items.sort((a, b) => a.x - b.x);
    const cells = []; let cell = null;
    for (const t of L.items) {
      if (!t.s.replace(/\s/g, '')) { if (cell) cell.gapSpace = true; continue; }
      const gap = cell ? (t.x - cell.x1) : 999;
      if (cell && gap < Math.max(1.2, t.h * 0.6) && !(cell.gapSpace && gap > t.h * 0.3)) {
        cell.t += (gap > t.h * 0.15 || cell.gapSpace ? ' ' : '') + t.s; cell.x1 = Math.max(cell.x1, t.x + t.w); cell.gapSpace = false;
      } else { cell = { t: t.s, x0: t.x, x1: t.x + t.w, gapSpace: false }; cells.push(cell); }
    }
    for (const c of cells) c.t = c.t.replace(/\s+/g, ' ').trim();
    if (cells.length) out.push({ y: L.y, h: L.h, cells });
  }
  return out;
}
const PDF_JUNK = /page\s*\d+\s*(of|\/)\s*\d+|statement of account|computer generated|computer-generated|discrepancy|^note\s*:|in case you find|contents of this statement|cyber crime|helpline|^\*?all dates are|does not require|generated on|^page\s*\d+$|customer care|registered office|www\.|toll free|^\*+|end of statement|abbreviations/i;

function signed(a) { return (a.side === 'dr' || a.neg) ? -a.p : a.p; }
/* "-", "0", "0.00", "NA" placeholders in empty columns (SBI prints 0 in the unused Credit/Debit column) */
function isFiller(t) { return /^(-+|0|0\.00|nil|na)$/i.test(String(t).replace(/\s/g, '')); }
/* "30-08-2026 UPI/2258..." (value date glued to the description) -> "UPI/2258..." */
function stripLeadDate(t) { const m = /^(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{1,2}[\s-][A-Za-z]{3}[\s-]\d{2,4})\s+(\S[\s\S]*)$/.exec(t); return (m && parseDateAny(m[1])) ? m[2] : t; }
function leadingDate(cells) {
  /* skip a leading serial-number cell (Bank of Baroda: "Serial No | Transaction Date | ...") */
  if (cells.length > 1 && /^\d{1,4}\.?$/.test(cells[0].t) && parseDateAny(cells[1].t)) {
    const r0 = leadingDate(cells.slice(1)); if (r0.date) { r0.used += 1; return r0; }
  }
  for (let n = 1; n <= 3 && n <= cells.length; n++) {
    const s = cells.slice(0, n).map(c => c.t).join(' ');
    const d = parseDateAny(s);
    if (d) {
      const m = /^(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?[\s\-/.,]*[A-Za-z]{3,9}[\s\-/.,']*\d{2,4})/.exec(s);
      if (m && m[0].length >= s.length - 1) return { date: d, used: n, rest: '' };
      if (n === 1) return { date: d, used: 1, rest: s.slice(m ? m[0].length : 0).replace(/^\s+/, '') };
    }
  }
  return { date: '', used: 0, rest: '' };
}
function assignAmounts(t, amts, head) {
  const cols = [];
  if (head) { if (head.debit) cols.push(['debit', head.debit]); if (head.credit) cols.push(['credit', head.credit]); if (head.bal) cols.push(['bal', head.bal]); if (head.amount) cols.push(['amount', head.amount]); }
  if (cols.length >= 2) {
    for (const a of amts) {
      let best = null, bd = 1e9;
      for (const [k, h] of cols) { const dd = Math.min(Math.abs(a.x1 - h.x1), Math.abs((a.x0 + a.x1) / 2 - h.c)); if (dd < bd) { bd = dd; best = k; } }
      if (best === 'bal') t.balance = signed(a);
      else if (best === 'debit') t.debit = a.p;
      else if (best === 'credit') t.credit = a.p;
      else if (best === 'amount') { if (a.side === 'dr' || a.neg) t.debit = a.p; else t.credit = a.p; }
    }
    if (t.debit && t.credit) { t.amt = Math.max(t.debit, t.credit); t.debit = 0; t.credit = 0; }
  }
  if (!t.debit && !t.credit && t.amt === undefined) {
    if (amts.length >= 2) { t.balance = signed(amts[amts.length - 1]); const x = amts[amts.length - 2]; t.amt = x.p; if (x.side === 'dr') t.debit = x.p; else if (x.side === 'cr') t.credit = x.p; }
    else if (amts.length === 1) { const y = amts[0]; t.amt = y.p; if (y.side === 'dr') t.debit = y.p; else if (y.side === 'cr') t.credit = y.p; }
  }
  if (t.debit) t.hint = 'debit'; else if (t.credit) t.hint = 'credit';
}
/* A PDF may hold several accounts (Bank of Baroda e-statement: savings + each loan).
   Split at "Statement of transactions in <type> Account <no>" and parse each part on its own. */
const SECTION_RE = /statement of transactions in\s+(?:the\s+)?([a-z ]*?)\s*a\/?c(?:count)?\s*(?:no\.?\s*)?[:-]?\s*([0-9xX*]{6,})/i;
export function parsePdfStatement(pages) {
  const lines = [];
  pages.forEach((pg, p) => pg.forEach(ln => { ln.page = p; lines.push(ln); }));
  let allText = '';
  for (let i = 0; i < lines.length && i < 400; i++) allText += ' ' + lines[i].cells.map(c => c.t).join(' ');
  const bank = detectBank(allText);
  const secs = [{ kind: 'main', acct: '', lines: [] }];
  for (const ln of lines) {
    const m = SECTION_RE.exec(ln.cells.map(c => c.t).join(' '));
    if (m) { secs.push({ kind: /loan/i.test(m[1]) ? 'loan' : 'deposit', acct: m[2], lines: [] }); continue; }
    secs[secs.length - 1].lines.push(ln);
  }
  if (secs.length === 1) return parsePdfLines(lines, bank);
  let main = null, firstErr = null; const loans = [];
  for (const sct of secs) {
    if (!sct.lines.length) continue;
    const r = parsePdfLines(sct.lines, bank);
    if (sct.kind === 'loan') { if (!r.error) { r.acct = sct.acct; r.detail = loanDetailFrom(sct.lines); loans.push(r); } continue; }
    if (r.error) { if (!firstErr) firstErr = r; continue; }
    if (!main) { main = r; main.acct = sct.acct; }
  }
  if (!main) return firstErr || { error: 'No savings/current account transactions found in this PDF.' };
  main.loans = loans;
  return main;
}
/* "SANCTIONED DATE | SANCTIONED AMOUNT | EMI | TENURE | ROI (%) | ..." header with the values on the next line */
export function loanDetailFrom(lines) {
  for (let i = 0; i + 1 < lines.length; i++) {
    const h = lines[i].cells, txt = h.map(c => c.t).join(' ');
    if (!/\bemi\b/i.test(txt) || !/roi|rate/i.test(txt)) continue;
    let vals = lines[i + 1].cells;
    if (i + 2 < lines.length && !/\d/.test(vals.map(c => c.t).join(''))) vals = lines[i + 2].cells;
    const out = {};
    for (const hc of h) {
      const name = hc.t.toLowerCase(), cx = (hc.x0 + hc.x1) / 2; let best = null, bd = 1e9;
      for (const v of vals) { const d = Math.abs((v.x0 + v.x1) / 2 - cx); if (d < bd) { bd = d; best = v.t; } }
      if (best === null) continue;
      if (/^emi$/.test(name)) out.emi = toPaise(best) || 0;
      else if (/roi|rate/.test(name)) out.rate = parseFloat(best);
      else if (/sanctioned amount|loan amount/.test(name)) out.sanctioned = toPaise(best) || 0;
      else if (/tenure/.test(name)) out.tenure = parseInt(best, 10);
      else if (/next emi|next due/.test(name)) out.nextDue = parseDateAny(best);
    }
    return out;
  }
  return {};
}
function parsePdfLines(lines, bank) {
  let head = null;
  const headerFrom = cells => {
    const col = {};
    for (const c of cells) { const kind = headerKind(c.t); if (kind && !col[kind]) col[kind] = { x0: c.x0, x1: c.x1, c: (c.x0 + c.x1) / 2 }; }
    return col;
  };
  const isHeaderLine = ln => { const c = headerFrom(ln.cells); return !!(c.date && (c.debit || c.credit || c.amount)); };
  for (let i = 0; i < lines.length && !head; i++) { const c1 = headerFrom(lines[i].cells); if (c1.date && (c1.debit || c1.credit)) head = c1; }
  /* two-line headers ("Transaction" / "Date") only if no single line qualifies */
  for (let i = 0; i + 1 < lines.length && !head; i++) {
    if (lines[i + 1].page !== lines[i].page) continue;
    const na = Object.keys(headerFrom(lines[i].cells)).length, nb = Object.keys(headerFrom(lines[i + 1].cells)).length;
    if (na < 2 || nb < 1) continue;
    const c2 = headerFrom(lines[i].cells.concat(lines[i + 1].cells));
    if (c2.date && c2.debit && c2.credit) head = c2;
  }
  const txns = [], meta = { opening: null, closing: null };
  let cur = null, contCount = 0, pendingClosingLabel = false, orphans = [], inTable = !head;
  /* Description lines without date/amount belong to whichever transaction row they sit nearest:
     HDFC wraps text BELOW its row, SBI prints it ABOVE the vertically centred date. */
  const placeOrphans = t => {
    const prev = txns.length ? txns[txns.length - 1] : null, before = [];
    for (const o of orphans) {
      const up = (prev && prev.page === o.page) ? Math.abs(prev.y - o.y) : 1e9, down = (t.page === o.page) ? Math.abs(o.y - t.y) : 1e9;
      if (Math.min(up, down) > o.h * 2.6) continue; /* too far from any row: page text, not a description */
      if (down < up) before.push(o.text); else if (prev) prev.narration += ' ' + o.text;
    }
    if (before.length) t.narration = before.join(' ') + (t.narration ? ' ' + t.narration : '');
    orphans = [];
  };
  const flushOrphans = () => {
    const prev = txns.length ? txns[txns.length - 1] : null;
    for (const o of orphans) if (prev && prev.page === o.page && Math.abs(prev.y - o.y) <= o.h * 2.6) prev.narration += ' ' + o.text;
    orphans = [];
  };
  for (const L of lines) {
    const cells = L.cells, text = cells.map(c => c.t).join(' '), lt = text.toLowerCase();
    if (isHeaderLine(L) || (head && /\b(narration|particulars|description)\b/i.test(text) && /balance/i.test(text))) { flushOrphans(); cur = null; inTable = true; continue; }
    const amts = [];
    for (let j = 0; j < cells.length; j++) {
      let ct = cells[j].t.replace(/^(₹|rs\.?|inr)\s*/i, '');
      if (j + 1 < cells.length && /^(cr|dr)\.?$/i.test(cells[j + 1].t) && AMT_RE.test(ct)) { ct = ct + ' ' + cells[j + 1].t; cells[j + 1].used = true; }
      if (AMT_RE.test(ct)) { const aw = amtWithSide(ct); amts.push({ p: Math.abs(aw.p), neg: aw.p < 0, side: aw.side, x0: cells[j].x0, x1: cells[j].x1, idx: j }); cells[j].amt = true; }
    }
    if (/closing\s*bal|balance\s*c\/?f|carried forward/.test(lt)) {
      if (amts.length) meta.closing = signed(amts[amts.length - 1]);
      else pendingClosingLabel = /opening/.test(lt) ? 'both' : 'closing';
      cur = null; continue;
    }
    if (pendingClosingLabel) {
      if (amts.length >= 2) { meta.closing = signed(amts[amts.length - 1]); if (pendingClosingLabel === 'both') meta.opening = signed(amts[0]); }
      pendingClosingLabel = false; if (amts.length && !leadingDate(cells).date) continue;
    }
    /* opening balance, also when it is a dated row (Bank of Baroda "1 | 30-08-2026 | Opening Balance") */
    if (/opening\s*bal|balance\s*b\/?f|brought forward|balance as on|balance as of/.test(lt) && (!leadingDate(cells).date || /opening\s*bal|brought forward|b\/f/.test(lt))) {
      if (amts.length && meta.opening === null) meta.opening = signed(amts[amts.length - 1]);
      cur = null; continue;
    }
    const ld = leadingDate(cells);
    if (!inTable) continue; /* account summaries / loan-detail rows above the table are not transactions */
    if (ld.date && amts.length) {
      const t = { date: ld.date, narration: '', debit: 0, credit: 0, balance: null, hint: '', page: L.page, y: L.y };
      const narr = []; if (ld.rest) narr.push(ld.rest);
      for (let j = ld.used; j < cells.length; j++) { if (cells[j].amt || cells[j].used || isFiller(cells[j].t)) continue; if (parseDateAny(cells[j].t) && cells[j].t.length <= 12) continue; narr.push(stripLeadDate(cells[j].t)); }
      t.narration = narr.join(' ');
      assignAmounts(t, amts, head);
      if (t.debit || t.credit || t.amt) { placeOrphans(t); txns.push(t); cur = t; contCount = 0; } else cur = null;
      continue;
    }
    if (ld.date && !amts.length && ld.used === cells.length && !ld.rest && cur && !cur.pending && cur.page === L.page && Math.abs(cur.y - L.y) <= (L.h || 8) * 2.6) {
      cur.narration += ' ' + text; contCount++; continue; /* wrapped description that is just a date ("...to" / "31-07-2026") */
    }
    if (ld.date && !amts.length) {
      cur = { date: ld.date, narration: (ld.rest ? ld.rest + ' ' : '') + cells.slice(ld.used).filter(c => !isFiller(c.t)).map(c => c.t).join(' '), debit: 0, credit: 0, balance: null, pending: true, page: L.page, y: L.y };
      contCount = 0; continue;
    }
    if (!ld.date && amts.length && cur && cur.pending) {
      const nar2 = cells.filter(c => !c.amt && !c.used && !isFiller(c.t)).map(c => c.t);
      if (nar2.length) cur.narration += ' ' + nar2.join(' ');
      assignAmounts(cur, amts, head); delete cur.pending;
      if (cur.debit || cur.credit || cur.amt) { placeOrphans(cur); txns.push(cur); contCount = 0; } else cur = null;
      continue;
    }
    if (!ld.date && !amts.length && (cur || meta.opening !== null) && !PDF_JUNK.test(text) && contCount < 4) {
      if (cur && cur.pending) cur.narration += ' ' + text;
      else orphans.push({ text: cells.filter(c => !isFiller(c.t)).map(c => c.t).join(' '), y: L.y, page: L.page, h: L.h || 8 });
      contCount++; continue;
    }
    if (PDF_JUNK.test(text)) { flushOrphans(); cur = null; }
  }
  flushOrphans();
  for (const t of txns) { t.narration = t.narration.replace(/\s+/g, ' ').trim(); delete t.y; }
  if (!txns.length) return { error: 'No transactions recognised in this PDF. If it is a scanned image (not text), download the CSV/Excel version from net banking instead.' };
  return finalizeTxns(txns, meta, bank);
}

/* Date order, settle debit/credit using the running balance, opening/closing, and the statement's own arithmetic check. */
export function finalizeTxns(txns, meta, bank) {
  if (!txns.length) return { error: 'No transactions found.' };
  const first = txns[0].date, last = txns[txns.length - 1].date;
  let descending = first > last;
  if (first === last && txns.length > 1 && txns[0].balance != null && txns[1].balance != null) {
    const a0 = txns[1], b0 = txns[0], amt1 = a0.debit || a0.credit || a0.amt || 0;
    if (Math.abs(b0.balance - a0.balance) === amt1 && Math.abs(txns[1].balance - txns[0].balance) !== (txns[1].debit || txns[1].credit || txns[1].amt)) descending = true;
  }
  if (descending) txns.reverse();
  let warn = 0;
  for (let i = 0; i < txns.length; i++) {
    const t = txns[i]; const amt = t.debit || t.credit || t.amt || 0;
    const prev = i > 0 ? txns[i - 1].balance : meta.opening;
    if (prev != null && t.balance != null) {
      const d = t.balance - prev;
      if (d === -amt) { t.debit = amt; t.credit = 0; t.check = 'ok'; continue; }
      if (d === amt) { t.credit = amt; t.debit = 0; t.check = 'ok'; continue; }
      t.check = 'mismatch';
    }
    if (!t.debit && !t.credit) { t.debit = amt; t.check = 'guess'; warn++; }
  }
  for (const t of txns) { delete t.amt; delete t.pending; }
  const f = txns[0], l = txns[txns.length - 1];
  const opening = meta.opening != null ? meta.opening : (f.balance != null ? f.balance - f.credit + f.debit : null);
  const closing = meta.closing != null ? meta.closing : l.balance;
  let dr = 0, cr = 0; for (const t of txns) { dr += t.debit; cr += t.credit; }
  const arith = (opening != null && closing != null) ? (opening + cr - dr - closing) : null;
  return { txns, opening, closing, from: f.date, to: l.date, totalDebit: dr, totalCredit: cr, arith, guesses: warn, bank: bank || 'generic' };
}
