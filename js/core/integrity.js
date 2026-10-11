/* Self-checks run on every open; results feed the Health screen. */
import { makeCtx, trialBalance, isBalanced, balanceSheet } from './books.js';
import { fyOf, fyRange, today } from '../lib/dates.js';

export function checkEntity(data) {
  const ctx = makeCtx(data);
  const issues = [];
  const gIds = new Set(ctx.groups.map(g => g.id));
  for (const l of ctx.ledgers) if (!gIds.has(l.groupId)) issues.push({ level: 'error', text: `Ledger “${l.name}” has no valid group.` });
  if (!ctx.capital) issues.push({ level: 'error', text: 'No capital account ledger — opening balances cannot be balanced.' });
  let unbalanced = 0, orphan = 0, badAmt = 0;
  for (const v of ctx.vouchers) {
    if (!isBalanced(v)) unbalanced++;
    for (const ln of v.lines) {
      if (!ctx.lById.has(ln.ledgerId)) orphan++;
      if (!Number.isInteger(ln.dr || 0) || !Number.isInteger(ln.cr || 0)) badAmt++;
    }
  }
  if (unbalanced) issues.push({ level: 'error', text: `${unbalanced} voucher(s) do not balance.` });
  if (orphan) issues.push({ level: 'error', text: `${orphan} voucher line(s) point to a missing ledger.` });
  if (badAmt) issues.push({ level: 'error', text: `${badAmt} line(s) have non-integer paise.` });
  const tb = trialBalance(ctx, { to: '' });
  if (tb.diff !== 0) issues.push({ level: 'error', text: `Trial balance is off by ${tb.diff / 100}.` });
  const t = today();
  const bs = balanceSheet(ctx, { asOf: t, periodFrom: fyRange(fyOf(t)).from });
  if (bs.diff !== 0) issues.push({ level: 'error', text: `Balance sheet does not tally (difference ${bs.diff / 100}).` });
  return { ok: !issues.some(i => i.level === 'error'), issues, counts: { vouchers: ctx.vouchers.length, ledgers: ctx.ledgers.length }, tbDiff: tb.diff };
}

export function checkBackups(lastBackupAt, now = Date.now()) {
  if (!lastBackupAt) return { level: 'warn', text: 'No backup downloaded yet. Settings → Backup → Download backup.' };
  const days = Math.floor((now - Date.parse(lastBackupAt)) / 864e5);
  if (days > 14) return { level: 'warn', text: `Last backup was ${days} days ago.` };
  return { level: 'ok', text: `Last backup ${days === 0 ? 'today' : days + ' day(s) ago'}.` };
}
