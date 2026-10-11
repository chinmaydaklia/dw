/* Simple entry screens -> balanced double-entry vouchers. Pure: callers pass the entity context. */
import { uid, nowISO } from '../lib/util.js';
import { isDate, fyOf } from '../lib/dates.js';
import { PAYMENT_NATURES } from './masters.js';

export const VTYPES = {
  receipt: { name: 'Receipt', short: 'Rcpt', key: 'F6', prefix: 'R' },
  payment: { name: 'Payment', short: 'Pymt', key: 'F5', prefix: 'P' },
  contra: { name: 'Contra', short: 'Ctra', key: 'F4', prefix: 'C' },
  journal: { name: 'Journal', short: 'Jrnl', key: 'F7', prefix: 'J' }
};

const L = (ledgerId, dr, cr, note) => {
  const o = { ledgerId, dr: dr || 0, cr: cr || 0 };
  if (note) o.note = note;
  return o;
};

export function newVoucher(entityId, p) {
  return {
    id: uid('vch'), entityId, no: '', type: p.type || 'journal', src: p.src || 'journal', date: p.date,
    narration: (p.narration || '').trim(), lines: p.lines,
    tags: { siteId: '', owner: '', custom: [], ...(p.tags || {}) }, meta: p.meta || {},
    batchId: p.batchId || '', fp: p.fp || '', recurringId: p.recurringId || '',
    createdAt: nowISO(), updatedAt: nowISO()
  };
}

/* Merge lines on the same ledger and side, drop zero lines. */
export function tidyLines(lines) {
  const out = [];
  for (const ln of lines) {
    const dr = Math.round(ln.dr || 0), cr = Math.round(ln.cr || 0);
    if (!ln.ledgerId || (!dr && !cr)) continue;
    const net = dr - cr;
    if (!net) continue;
    const same = out.find(o => o.ledgerId === ln.ledgerId && Math.sign(o.dr - o.cr) === Math.sign(net) && !o.note && !ln.note);
    if (same) { if (net > 0) same.dr += net; else same.cr += -net; }
    else out.push(L(ln.ledgerId, net > 0 ? net : 0, net < 0 ? -net : 0, ln.note));
  }
  return out;
}

/* Tally-style voucher type from the lines. */
export function inferType(ctx, lines) {
  const money = lines.filter(l => ctx.isMoney(l.ledgerId));
  const other = lines.filter(l => !ctx.isMoney(l.ledgerId));
  if (money.length && !other.length) return 'contra';
  if (!money.length) {
    /* card spends read as payments */
    const card = lines.some(l => { const x = ctx.lById.get(l.ledgerId); return x && ctx.natureOf(x) === 'card' && l.cr > 0; });
    return card ? 'payment' : 'journal';
  }
  const net = money.reduce((t, l) => t + l.dr - l.cr, 0);
  return net > 0 ? 'receipt' : net < 0 ? 'payment' : 'journal';
}

/* Income: Dr money (net), Dr TDS receivable (tds), Cr income (gross). Optional cash/digital split. */
export function buildIncome(ctx, p) {
  const gross = p.gross, tds = p.tds || 0;
  const lines = [];
  if (p.split) { /* [{ledgerId, amount}] e.g. cash + UPI */
    for (const s of p.split) lines.push(L(s.ledgerId, s.amount, 0));
  } else lines.push(L(p.moneyLedgerId, gross - tds, 0));
  if (tds) lines.push(L(p.tdsLedgerId, tds, 0));
  lines.push(L(p.incomeLedgerId, 0, gross));
  return { type: 'receipt', src: 'income', date: p.date, narration: p.narration, lines: tidyLines(lines), tags: p.tags, meta: p.meta };
}

/* Expense with optional split across ledgers: Dr each expense, Cr money / card. */
export function buildExpense(ctx, p) {
  const lines = p.splits.map(s => L(s.ledgerId, s.amount, 0, s.note));
  const total = p.splits.reduce((t, s) => t + (s.amount || 0), 0);
  lines.push(L(p.moneyLedgerId, 0, total));
  return { type: 'payment', src: 'expense', date: p.date, narration: p.narration, lines: tidyLines(lines), tags: p.tags, meta: p.meta };
}

export function buildTransfer(ctx, p) {
  const lines = tidyLines([L(p.toLedgerId, p.amount, 0), L(p.fromLedgerId, 0, p.amount)]);
  return { type: inferType(ctx, lines), src: 'transfer', date: p.date, narration: p.narration, lines, tags: p.tags };
}

/* Investment. invest: Dr investment, Cr money. redeem: Dr money (proceeds), Cr investment (cost), gain/loss to a ledger.
   income: Dr money, Cr dividend/interest ledger (handled by buildIncome). */
export function buildInvestment(ctx, p) {
  let lines;
  if (p.kind === 'invest') lines = [L(p.investLedgerId, p.amount, 0), L(p.moneyLedgerId, 0, p.amount)];
  else {
    const cost = p.cost === null || p.cost === undefined || p.cost === '' ? p.amount : p.cost;
    const gain = p.amount - cost;
    lines = [L(p.moneyLedgerId, p.amount, 0), L(p.investLedgerId, 0, cost)];
    if (gain) lines.push(gain > 0 ? L(p.gainLedgerId, 0, gain) : L(p.gainLedgerId, -gain, 0));
  }
  lines = tidyLines(lines);
  return { type: inferType(ctx, lines), src: 'investment', date: p.date, narration: p.narration, lines, tags: p.tags, meta: { kind: p.kind } };
}

/* Loans. borrow: Dr money Cr loan. repay (EMI): Dr loan (principal), Dr interest, Cr money.
   lend: Dr loan-given Cr money. recover: Dr money, Cr loan-given (principal), Cr interest income. */
export function buildLoan(ctx, p) {
  const principal = p.principal || 0, interest = p.interest || 0;
  let lines;
  switch (p.kind) {
    case 'borrow': lines = [L(p.moneyLedgerId, principal, 0), L(p.loanLedgerId, 0, principal)]; break;
    case 'repay': lines = [L(p.loanLedgerId, principal, 0), L(p.interestLedgerId, interest, 0), L(p.moneyLedgerId, 0, principal + interest)]; break;
    case 'lend': lines = [L(p.loanLedgerId, principal, 0), L(p.moneyLedgerId, 0, principal)]; break;
    case 'recover': lines = [L(p.moneyLedgerId, principal + interest, 0), L(p.loanLedgerId, 0, principal), L(p.interestLedgerId, 0, interest)]; break;
    default: throw new Error('Unknown loan entry ' + p.kind);
  }
  lines = tidyLines(lines);
  return { type: inferType(ctx, lines), src: 'loan', date: p.date, narration: p.narration, lines, tags: p.tags, meta: { kind: p.kind } };
}

/* Clinic / hospital daily summary: cash + UPI/card with patient count, no patient names. */
export function buildDailySummary(ctx, p) {
  const lines = tidyLines([L(p.cashLedgerId, p.cash, 0), L(p.digitalLedgerId, p.digital, 0), L(p.incomeLedgerId, 0, (p.cash || 0) + (p.digital || 0))]);
  return {
    type: 'receipt', src: 'daily', date: p.date, narration: p.narration || 'Daily summary', lines,
    tags: { ...(p.tags || {}), siteId: p.siteId || '' }, meta: { visits: p.visits || 0, cash: p.cash || 0, digital: p.digital || 0 }
  };
}

export function buildJournal(ctx, p) {
  const lines = tidyLines(p.lines);
  return { type: p.type || inferType(ctx, lines), src: 'journal', date: p.date, narration: p.narration, lines, tags: p.tags, meta: p.meta };
}

/* Validation. Returns [] when fine, else human-readable messages. */
export function validateVoucher(ctx, v, { isNew = true, previous = null } = {}) {
  const errs = [];
  if (!isDate(v.date)) errs.push('Enter a valid date.');
  if (!Array.isArray(v.lines) || v.lines.length < 2) errs.push('A voucher needs at least two lines (one debit, one credit).');
  let d = 0, c = 0;
  for (const ln of v.lines || []) {
    const l = ctx.lById.get(ln.ledgerId);
    if (!l) { errs.push('A line points to a ledger that does not exist.'); continue; }
    if (l.entityId !== ctx.entity.id) errs.push(`“${l.name}” belongs to another entity.`);
    if (isNew && l.archived) errs.push(`“${l.name}” is archived.`);
    const dr = ln.dr || 0, cr = ln.cr || 0;
    if (!Number.isInteger(dr) || !Number.isInteger(cr) || dr < 0 || cr < 0) errs.push('Amounts must be positive whole paise.');
    if (dr && cr) errs.push('A line cannot be both debit and credit.');
    if (!dr && !cr) errs.push('Remove empty lines.');
    d += dr; c += cr;
  }
  if (d !== c) errs.push(`Debits (${d / 100}) and credits (${c / 100}) do not match.`);
  if (d === 0) errs.push('Amount cannot be zero.');
  const lock = ctx.entity.lockedUpto;
  if (lock) {
    if (v.date && v.date <= lock) errs.push(`Books are locked up to ${lock}. Unlock the year to change entries in it.`);
    if (previous && previous.date <= lock) errs.push(`This entry is in a locked period (up to ${lock}).`);
  }
  return [...new Set(errs)];
}

/* Next voucher number per entity, type and financial year: R/2026-27/0007 */
export function nextNumber(vouchers, entityId, type, date) {
  const fy = fyOf(date);
  const prefix = (VTYPES[type] || VTYPES.journal).prefix + '/' + fy + '/';
  let max = 0;
  for (const v of vouchers) {
    if (v.entityId !== entityId || !v.no || !v.no.startsWith(prefix)) continue;
    const n = parseInt(v.no.slice(prefix.length), 10);
    if (n > max) max = n;
  }
  return prefix + String(max + 1).padStart(4, '0');
}

export function paymentLedgers(ctx) {
  return ctx.ledgers.filter(l => !l.archived && PAYMENT_NATURES.has(ctx.natureOf(l)));
}
