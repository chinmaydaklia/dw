/* Quick one-line entry: "450 petrol hdfc", "+12000 pnh sbi", "5000 sbi to cash", "y 1200 groceries".
   Returns a draft voucher plus an explanation, or { error }. Nothing is saved here. */
import { toPaise } from '../lib/money.js';
import { today, addDays, parseDateAny, MONTHS, pad } from '../lib/dates.js';
import { PAYMENT_NATURES } from './masters.js';
import { tidyLines, inferType } from './vouchers.js';

const STOP = new Set(['to', 'from', 'in', 'into', 'via', 'by', 'paid', 'for', 'on', 'at', 'the', 'a', 'rs', 'inr', 'received', 'got', 'spent', 'pay']);

function score(ledger, word) {
  const hay = (ledger.name + ' ' + (ledger.alias || '')).toLowerCase();
  const toks = hay.split(/[^a-z0-9]+/).filter(Boolean);
  if (toks.includes(word)) return 3;
  if (toks.some(t => t.startsWith(word)) && word.length >= 3) return 2;
  if (word.length >= 4 && hay.includes(word)) return 1;
  return 0;
}

function parseDateWord(w, ref) {
  if (w === 'today' || w === 't') return ref;
  if (w === 'yesterday' || w === 'y') return addDays(ref, -1);
  let m = /^(\d{1,2})[/\-.](\d{1,2})$/.exec(w);
  if (m) {
    const y = Number(ref.slice(0, 4));
    let d = y + '-' + pad(m[2]) + '-' + pad(m[1]);
    if (d > ref) d = (y - 1) + '-' + pad(m[2]) + '-' + pad(m[1]);
    return parseDateAny(d) || '';
  }
  if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(w)) return parseDateAny(w);
  return '';
}

export function parseQuick(ctx, text, { ref = today(), defaultMoneyId = '' } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { error: 'Type an amount and a few words, e.g. “450 petrol hdfc”.' };
  const words = raw.toLowerCase().split(/\s+/);
  let amount = null, sign = 0, date = ref;
  const rest = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const dw = parseDateWord(w, ref);
    if (dw) { date = dw; continue; }
    /* "12 oct" */
    if (/^\d{1,2}$/.test(w) && MONTHS[words[i + 1]] && amount !== null) {
      const y = Number(ref.slice(0, 4));
      let d = y + '-' + pad(MONTHS[words[i + 1]]) + '-' + pad(w);
      if (d > ref) d = (y - 1) + d.slice(4);
      if (parseDateAny(d)) { date = d; i++; continue; }
    }
    if (amount === null && /^[+-]?₹?[\d,]*\.?\d+(k|l|lac|lakh|cr)?$/i.test(w)) {
      if (w[0] === '+') sign = 1; else if (w[0] === '-') sign = -1;
      amount = toPaise(w.replace(/^[+-]/, ''));
      continue;
    }
    rest.push(w);
  }
  if (!amount || amount <= 0) return { error: 'No amount found.' };

  /* match ledgers; preposition before a money ledger tells direction ("from hdfc", "to cash") */
  const active = ctx.ledgers.filter(l => !l.archived);
  const found = [];
  const narr = [];
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i];
    if (STOP.has(w)) continue;
    let best = null, bs = 0;
    for (const l of active) { const s = score(l, w); if (s > bs) { bs = s; best = l; } }
    if (best && bs >= 2 && !found.some(f => f.ledger.id === best.id)) {
      const prep = rest[i - 1];
      found.push({ ledger: best, prep: prep === 'to' || prep === 'into' || prep === 'in' ? 'to' : prep === 'from' ? 'from' : '', word: w });
    } else narr.push(w);
  }
  const isPay = l => PAYMENT_NATURES.has(ctx.natureOf(l));
  const rootOf = l => ctx.rootOf(l);
  let money = found.filter(f => isPay(f.ledger));
  const other = found.filter(f => !isPay(f.ledger));
  const def = defaultMoneyId && ctx.lById.get(defaultMoneyId);

  let lines, explain;
  if (money.length >= 2 && !other.length) {
    /* contra: "sbi to cash" or "from sbi cash" */
    let from = money.find(f => f.prep === 'from') || money.find(f => f.prep !== 'to') || money[0];
    let to = money.find(f => f !== from);
    if (from.prep === 'to') [from, to] = [to, from];
    lines = [{ ledgerId: to.ledger.id, dr: amount, cr: 0 }, { ledgerId: from.ledger.id, dr: 0, cr: amount }];
    explain = `Transfer ${from.ledger.name} → ${to.ledger.name}`;
  } else {
    const target = other[0] ? other[0].ledger : null;
    const m = money[0] ? money[0].ledger : def;
    if (!target) return { error: 'Which ledger? Add a word like “petrol”, “pnh”, “rent”.', amount, date };
    if (!m) return { error: 'Which account? Add “cash”, “sbi”, “card”…', amount, date };
    const r = rootOf(target);
    let inflow;
    if (sign) inflow = sign > 0;
    else if (r === 'income') inflow = true;
    else if (r === 'expense') inflow = false;
    else if (r === 'liability') inflow = (money[0] && money[0].prep === 'to') || other[0].prep === 'from';
    else inflow = other[0].prep === 'from' || (money[0] && money[0].prep === 'to');
    lines = inflow
      ? [{ ledgerId: m.id, dr: amount, cr: 0 }, { ledgerId: target.id, dr: 0, cr: amount }]
      : [{ ledgerId: target.id, dr: amount, cr: 0 }, { ledgerId: m.id, dr: 0, cr: amount }];
    explain = inflow ? `${target.name} → received in ${m.name}` : `${target.name} ← paid from ${m.name}`;
  }
  lines = tidyLines(lines);
  const target = other[0] && other[0].ledger;
  const tags = target && target.siteId ? { siteId: target.siteId } : {};
  return {
    draft: { type: inferType(ctx, lines), src: 'quick', date, narration: narr.join(' '), lines, tags },
    explain, amount, date
  };
}
