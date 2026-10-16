/* Statement import planning: parsed rows -> review rows (rules, duplicates) -> vouchers. Pure. */
import { fingerprint, normNarr, uid, nowISO, clone } from '../lib/util.js';
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
      const own = (v.fps || []).find(x => x.l === ledgerId);
      const fp = own ? own.fp : v.fp && v.fpLedger === ledgerId ? v.fp : fingerprint(ledgerId, v.date, lineAmt(ln), v.narration);
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
      else {
        /* the same money already imported from ANOTHER of your accounts (same UPI / UTR reference) -> one transfer */
        const pair = findOwnTransfer(ctx, ledgerId, t.date, signedAmt, t.narration);
        if (pair) { r.pair = pair; r.counterId = pair.moneyId; r.hint = 'own'; }
      }
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

/* ---------- own-account transfers ----------
   A row whose UPI / UTR / IMPS reference (10+ digits) matches an entry already imported from another of your
   bank / cash / wallet accounts, for the same amount in the opposite direction within 3 days, is the same money
   moving between your own accounts. That entry (bank ↔ suspense / spending / income) is turned into ONE transfer
   (bank ↔ bank) instead of adding a second entry. */
export function refNumbers(t) { return new Set(String(t || '').match(/\d{10,}/g) || []); }
export function findOwnTransfer(ctx, ledgerId, date, signedAmt, narration) {
  const refs = refNumbers(narration);
  if (!refs.size) return null;
  const lo = addDays(date, -3), hi = addDays(date, 3);
  for (const v of ctx.vouchers) {
    if (v.date < lo || v.date > hi || v.lines.length !== 2 || v.pairId) continue;
    if (v.lines.some(l => l.ledgerId === ledgerId)) continue;
    const money = v.lines.find(l => ctx.isMoney(l.ledgerId) && lineAmt(l) === -signedAmt);
    const other = v.lines.find(l => l !== money);
    if (!money || !other || ctx.isMoney(other.ledgerId)) continue;
    const r2 = refNumbers((v.meta && v.meta.bankNarration || '') + ' ' + v.narration);
    for (const x of refs) if (r2.has(x)) return { voucher: v, moneyId: money.ledgerId, otherId: other.ledgerId };
  }
  return null;
}
/* the existing entry with its spending / income / suspense side moved to this account: now a transfer */
export function relinkAsTransfer(ctx, ledgerId, row) {
  const v = clone(row.pair.voucher);
  for (const l of v.lines) if (l.ledgerId === row.pair.otherId) l.ledgerId = ledgerId;
  v.type = inferType(ctx, v.lines);
  v.fps = [...(v.fps || []), ...(v.fp && v.fpLedger && !(v.fps || []).some(x => x.l === v.fpLedger) ? [{ l: v.fpLedger, fp: v.fp }] : []), { l: ledgerId, fp: row.fp }];
  v.meta = { ...(v.meta || {}), ownTransfer: { bankNarration2: row.narration, ref2: row.ref || '' } };
  return v;
}

/* ---------- loan sections of a bank e-statement (parsePdfStatement → res.loans) ---------- */
/* an existing loan account whose name / alias / note carries the loan account number (or its last 4 digits) */
export function matchLoanLedger(ctx, sec) {
  const acct = String(sec.acct || ''), last4 = acct.slice(-4);
  const loans = ctx.ledgers.filter(l => !l.archived && ctx.rootOf(l) === 'liability' && ctx.natureOf(l) !== 'card');
  return loans.find(l => acct && [l.name, l.alias, l.note, l.acctNo].join(' ').includes(acct))
    || loans.find(l => last4 && [l.name, l.alias, l.acctNo].join(' ').includes(last4)) || null;
}
/* Interest / charges the bank debited to the loan: Dr interest (or charges), Cr loan. Collections (credits) are the EMIs,
   which come from the savings rows, so they are not posted again. Re-imports are skipped by fingerprint. */
export function loanSectionVouchers(ctx, sec, { loanId, interestId, chargesId, batchId }) {
  const out = [];
  for (const t of sec.txns) {
    if (!t.debit) continue;
    const fp = fingerprint(loanId, t.date, -t.debit, t.narration);
    if (ctx.vouchers.some(v => v.fpLedger === loanId && v.fp === fp)) continue;
    const isInt = /\bint\b|interest|int\.|int\s*coll/i.test(t.narration);
    const v = newVoucher(ctx.entity.id, {
      type: 'journal', src: 'import', date: t.date, batchId, fp,
      narration: (isInt ? 'Interest charged by the bank — ' : 'Charged to loan — ') + t.narration,
      lines: tidyLines([{ ledgerId: isInt ? interestId : (chargesId || interestId), dr: t.debit, cr: 0 }, { ledgerId: loanId, dr: 0, cr: t.debit }]),
      meta: { bankNarration: t.narration, loanAcct: sec.acct }
    });
    v.fpLedger = loanId;
    out.push(v);
  }
  return out;
}
