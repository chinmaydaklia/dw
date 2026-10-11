/* Statement import planning: parsed rows -> review rows (rules, duplicates) -> vouchers. Pure. */
import { fingerprint, normNarr, uid, nowISO } from '../lib/util.js';
import { addDays } from '../lib/dates.js';
import { lineAmt } from '../core/books.js';
import { newVoucher, tidyLines, inferType } from '../core/vouchers.js';

const NARR_STOP = new Set(('upi neft imps rtgs dr cr to from by transfer trf tfr payment pay ref txn paid via the and ybl okaxis okhdfcbank okicici oksbi paytm yesb hdfc sbin icic utib barb idfb kkbk axis pos ecom ach nach mb ib bil inb onl int vps ipay mmt ifsc bank ltd pvt limited india').split(' '));
export function suggestKeyword(narr) {
  const t = normNarr(narr).split(' ');
  for (const w of t) if (w.length >= 3 && !NARR_STOP.has(w) && !/^\d+$/.test(w)) return w;
  return t[0] || '';
}
export function ruleMatch(rules, narr, dir) {
  const n = ' ' + normNarr(narr) + ' ';
  for (const r of rules) {
    if (!r || r.off) continue;
    if (r.dir && r.dir !== 'any' && r.dir !== dir) continue;
    const p = normNarr(r.pattern);
    if (!p) continue;
    if (n.includes(' ' + p + ' ')) return r;
    if (!p.includes(' ') && n.includes(p)) return r;
  }
  return null;
}

/* exact fingerprints of existing lines on this ledger: fp -> [voucher] (multiset) */
function fpIndex(ctx, ledgerId) {
  const idx = new Map();
  for (const v of ctx.vouchers) {
    for (const ln of v.lines) {
      if (ln.ledgerId !== ledgerId) continue;
      const fp = v.fp && v.fpLedger === ledgerId ? v.fp : fingerprint(ledgerId, v.date, lineAmt(ln), v.narration);
      if (!idx.has(fp)) idx.set(fp, []);
      idx.get(fp).push(v);
    }
  }
  return idx;
}

/* autoMap(narration, dir) → { ledgerId, hint } suggests a category when no rule matches (e.g. broker wallet, mutual fund) */
export function planRows(ctx, ledgerId, parsed, rules, suspenseId, autoMap = null) {
  const idx = fpIndex(ctx, ledgerId);
  const used = new Map(), seen = new Map();
  /* soft index: same ledger, same signed amount, within ±3 days (manual entries made before the import) */
  const soft = ctx.vouchers.filter(v => v.lines.some(l => l.ledgerId === ledgerId));
  return parsed.txns.map((t, i) => {
    const dir = t.debit ? 'debit' : 'credit';
    const amount = t.debit || t.credit;
    const signedAmt = dir === 'debit' ? -amount : amount;
    const fp = fingerprint(ledgerId, t.date, signedAmt, t.narration);
    const r = {
      n: i + 1, include: true, date: t.date, amount, dir, counterId: suspenseId || '', narration: t.narration,
      note: t.narration.slice(0, 140), ref: t.ref || '', balance: t.balance, check: t.check || '', fp, dup: null, soft: null, rule: ''
    };
    const hit = ruleMatch(rules, t.narration, dir);
    if (hit && ctx.lById.has(hit.ledgerId)) { r.counterId = hit.ledgerId; r.rule = hit.pattern; }
    else if (autoMap) { const m = autoMap(t.narration, dir); if (m && ctx.lById.has(m.ledgerId) && m.ledgerId !== ledgerId) { r.counterId = m.ledgerId; r.hint = m.hint; } }
    const cand = idx.get(fp) || []; const k = used.get(fp) || 0;
    if (k < cand.length) { r.dup = { voucher: cand[k] }; used.set(fp, k + 1); r.include = false; }
    else if (seen.has(fp)) { r.dup = { row: seen.get(fp) }; r.include = false; }
    else {
      const lo = addDays(t.date, -3), hi = addDays(t.date, 3);
      const m = soft.find(v => v.date >= lo && v.date <= hi && !v.batchId && v.lines.some(l => l.ledgerId === ledgerId && lineAmt(l) === signedAmt));
      if (m) r.soft = { voucher: m };
    }
    if (!seen.has(fp)) seen.set(fp, r.n);
    return r;
  });
}

export function rowToVoucher(ctx, ledgerId, row, batchId, bank) {
  const lines = tidyLines(row.dir === 'debit'
    ? [{ ledgerId: row.counterId, dr: row.amount, cr: 0 }, { ledgerId, dr: 0, cr: row.amount }]
    : [{ ledgerId, dr: row.amount, cr: 0 }, { ledgerId: row.counterId, dr: 0, cr: row.amount }]);
  const counter = ctx.lById.get(row.counterId);
  const v = newVoucher(ctx.entity.id, {
    type: inferType(ctx, lines), src: 'import', date: row.date, narration: row.note || row.narration, lines, batchId,
    fp: row.fp, tags: counter && counter.siteId ? { siteId: counter.siteId } : {},
    meta: { bankNarration: row.narration, ref: row.ref || '', bank: bank || '' }
  });
  v.fpLedger = ledgerId;
  return v;
}

export function makeBatch(ctx, { kind, ledgerId = '', file = '', bank = '', from = '', to = '', count = 0, opening = null, closing = null, openingAdj = 0, extra = {} }) {
  return { id: uid('bat'), entityId: ctx.entity.id, kind, ledgerId, file, bank, from, to, count, opening, closing, openingAdj, createdAt: nowISO(), ...extra };
}
