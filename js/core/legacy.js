/* One-time migration from DoctorWealth v1–v11 (localStorage "dw_state_v1" or its JSON backup).
   Pure: produces a plan (new ledgers, opening changes, vouchers, holdings, tax P&L, rules) that the UI
   reviews and commits as one undoable batch. The old data is never modified. */
import { makeLedger } from './masters.js';
import { newVoucher, tidyLines } from './vouchers.js';
import { uid, nowISO } from '../lib/util.js';
import { today, isDate } from '../lib/dates.js';

export const LEGACY_KEY = 'dw_state_v1';

export function looksLegacy(obj) {
  return !!obj && typeof obj === 'object' && obj.schemaVersion !== undefined && Array.isArray(obj.accounts) && (Array.isArray(obj.income) || Array.isArray(obj.expenses));
}

const toP = v => { if (v === null || v === undefined || v === '') return 0; const n = parseFloat(v); return isNaN(n) ? 0 : Math.round(n * 100); };
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };

/* Bring any old version to integer paise (v11 semantics) without touching the input. */
export function normalizeLegacy(src) {
  const s = JSON.parse(JSON.stringify(src));
  for (const k of ['accounts', 'incomeCats', 'expenseCats', 'income', 'expenses', 'transfers', 'investments', 'loans', 'loanLedger', 'opd', 'rules', 'taxPnl', 'hospitals']) if (!Array.isArray(s[k])) s[k] = [];
  s.settings = s.settings || {};
  const inPaise = (s.meta && s.meta.moneyUnit === 'paise') || (s.schemaVersion || 1) >= 11;
  if (!inPaise) {
    const conv = (arr, fields) => arr.forEach(r => fields.forEach(f => { if (r && r[f] !== undefined && r[f] !== null && r[f] !== '') r[f] = toP(r[f]); }));
    conv(s.accounts, ['opening']); conv(s.income, ['amount']); conv(s.expenses, ['amount', 'interest']); conv(s.transfers, ['amount']);
    conv(s.investments, ['avg', 'price', 'invested', 'value', 'sipAmount']); conv(s.loans, ['principal', 'outstanding', 'emi']);
    conv(s.loanLedger, ['amount', 'interest']); conv(s.taxPnl, ['stcg', 'ltcg', 'intraday', 'nonEquity', 'foOptions', 'foFutures', 'dividends', 'ledgerClose']);
  }
  for (const a of s.accounts) if (!a.owner) a.owner = a.type === 'spouse' ? 'spouse' : '';
  return s;
}

export function ownerOfAccount(s, id) {
  const a = s.accounts.find(x => x.id === id);
  if (a && a.owner) return a.owner === 'spouse' ? 'spouse' : 'me';
  if (a) {
    const nm = String(a.name).toLowerCase(); const wr = s.settings.walletRules || {};
    for (const k of Object.keys(wr)) for (const w of wr[k] || []) if (nm.includes(w)) return k === 'spouse' ? 'spouse' : 'me';
  }
  return 'me';
}
function investmentCost(iv) { const q = num(iv.qty), a = num(iv.avg); return q > 0 && a > 0 ? Math.round(q * a) : num(iv.invested); }
function investmentValue(iv) {
  const q = num(iv.qty), p = num(iv.price);
  if (q > 0 && p > 0) return Math.round(q * p);
  return num(iv.value) || num(iv.invested);
}
function incomeTds(x) { const r = num(x.tdsRate) / 100; return r > 0 && r < 1 ? Math.round(num(x.amount) * r / (1 - r)) : 0; }

/* Old app's own running balance per account (opening + every movement), used to verify the migration. */
export function legacyBalances(s) {
  const m = new Map(s.accounts.map(a => [a.id, num(a.opening)]));
  const add = (id, d) => { if (m.has(id)) m.set(id, m.get(id) + d); };
  for (const x of s.income) add(x.accountId, num(x.amount));
  for (const e of s.expenses) add(e.accountId, -num(e.amount));
  for (const t of s.transfers) { add(t.fromId, -num(t.amount)); add(t.toId, num(t.amount)); }
  for (const iv of s.investments) if (!iv.archived && iv.fundFrom) { const c = investmentCost(iv); if (c > 0) add(iv.fundFrom, -c); }
  for (const lp of s.loanLedger) add(lp.accountId, lp.kind === 'draw' ? num(lp.amount) : -num(lp.amount));
  return m;
}

const ACC_GROUP = { bank: 'bank', cash: 'cash', card: 'cards', investment: 'invest', wallet: 'bank', business: 'bank', spouse: 'bank' };
const INV_LEDGER = t => {
  const s = String(t || '').toLowerCase();
  if (/stock|etf|share|equity/.test(s)) return 'Stocks';
  if (/mutual|sip|fund/.test(s)) return 'Mutual Funds';
  if (/crypto/.test(s)) return 'Crypto (CoinDCX)';
  if (/gold|silver/.test(s)) return 'Gold';
  if (/\bfd\b|fixed/.test(s)) return 'Fixed Deposits';
  if (/ppf/.test(s)) return 'PPF';
  if (/nps/.test(s)) return 'NPS';
  if (/real estate|property|land/.test(s)) return 'Real Estate';
  return 'Other Investments';
};
function incomeTag(group, name) {
  const g = String(group || '').toLowerCase(), n = String(name || '').toLowerCase();
  if (/hospital|clinic|pharmacy|opd|consult/.test(g + ' ' + n)) return { gk: 'profinc', tag: 'prof_receipts' };
  if (/rent/.test(g + n)) return { gk: 'othinc', tag: 'rent' };
  if (/dividend/.test(g + n)) return { gk: 'othinc', tag: 'dividend' };
  if (/interest/.test(g + n)) return { gk: 'othinc', tag: 'interest' };
  if (/salary/.test(g + n)) return { gk: 'othinc', tag: 'salary' };
  return { gk: 'othinc', tag: 'other_income' };
}
function expenseTag(group) {
  return String(group || '').toLowerCase() === 'professional' ? { gk: 'profexp', tag: 'prof_expense' } : { gk: 'personal', tag: 'personal' };
}

/* Suggest a mapping old record -> existing ledger id (or '' = create new). */
export function suggestMapping(s, targets) {
  const map = {};
  const find = (owner, name, natureSet) => {
    const t = targets[owner]; if (!t) return '';
    const nm = String(name).toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
    const words = nm.split(/\s+/).filter(w => w.length >= 3 && !['savings', 'account', 'bank', 'the'].includes(w));
    const gOf = l => t.groups.find(g => g.id === l.groupId) || {};
    let best = '', bs = 0;
    for (const l of t.ledgers) {
      if (l.archived || l.system === 'capital') continue;
      if (natureSet && !natureSet.includes(gOf(l).nature)) continue;
      const hay = (l.name + ' ' + (l.alias || '')).toLowerCase();
      let sc = hay === nm ? 10 : 0;
      for (const w of words) if (hay.split(/[^a-z0-9]+/).includes(w)) sc += 2;
      if (sc > bs) { bs = sc; best = l.id; }
    }
    return bs >= 2 ? best : '';
  };
  for (const a of s.accounts) {
    const o = ownerOfAccount(s, a.id);
    const nat = { bank: ['bank'], wallet: ['bank'], business: ['bank'], spouse: ['bank'], cash: ['cash'], card: ['card'], investment: ['investment'] }[a.type] || null;
    map['acc:' + a.id] = find(o, a.name, nat);
  }
  for (const c of s.incomeCats) for (const o of ['me', 'spouse']) map[o + ':inc:' + c.id] = find(o, c.name, ['profincome', 'otherincome']);
  for (const c of s.expenseCats) if (!c.loanId) for (const o of ['me', 'spouse']) map[o + ':exp:' + c.id] = find(o, c.name, ['profexpense', 'personal', 'finance']);
  return map;
}

/* targets: { me: {entity, groups, ledgers}, spouse: {...} } ; mapping from suggestMapping (possibly edited). */
export function buildLegacyPlan(src, targets, mapping = {}) {
  const s = normalizeLegacy(src);
  const plan = { newLedgers: [], openingDeltas: new Map(), vouchers: [], holdings: [], taxPnl: [], rules: [], sites: [], warnings: [], checks: [] };
  const T = {};
  for (const o of ['me', 'spouse']) {
    if (!targets[o]) continue;
    T[o] = { ...targets[o], ledgers: targets[o].ledgers.slice() };
  }
  const ent = o => T[o] || T.me;
  const ownerKey = o => (T[o] ? o : 'me');
  const groupByKey = (o, key) => ent(o).groups.find(g => g.key === key) || ent(o).groups.find(g => g.root === 'asset');
  const addLedger = (o, gk, name, extra = {}) => {
    const t = ent(o);
    const l = makeLedger({ entityId: t.entity.id, groupId: groupByKey(o, gk).id, name, ...extra });
    l.legacy = true;
    t.ledgers.push(l); plan.newLedgers.push(l);
    return l;
  };
  const byName = (o, name) => ent(o).ledgers.find(l => !l.archived && l.name.toLowerCase() === name.toLowerCase());
  const ensure = (o, gk, name, extra) => byName(o, name) || addLedger(o, gk, name, extra);
  const system = (o, sys, gk, name) => ent(o).ledgers.find(l => l.system === sys) || addLedger(o, gk, name, { system: sys });
  const suspense = o => system(o, 'suspense', 'curliab', 'Suspense');
  const tdsL = o => ent(o).ledgers.find(l => l.taxTag === 'tds_receivable') || addLedger(o, 'taxassets', 'TDS Receivable', { taxTag: 'tds_receivable', system: 'tds' });
  const addOpening = (ledgerId, amt) => { if (amt) plan.openingDeltas.set(ledgerId, (plan.openingDeltas.get(ledgerId) || 0) + amt); };
  const inter = (o, other) => {
    const t = ent(o), ot = ent(other);
    return t.ledgers.find(l => l.interEntityWith === ot.entity.id) || addLedger(o, 'advances', 'Current A/c – ' + ot.entity.name, { interEntityWith: ot.entity.id, note: 'Money held for / owed by ' + ot.entity.name + '. Balances cancel out in the family view.' });
  };
  const dateOf = (...c) => c.find(isDate) || today();
  const push = (o, p) => {
    const lines = tidyLines(p.lines);
    if (lines.length < 2) return;
    const v = newVoucher(ent(o).entity.id, { ...p, lines, src: 'legacy' });
    v.legacyId = p.legacyId || '';
    plan.vouchers.push(v);
  };
  const moneyType = (o, l) => { const g = ent(o).groups.find(x => x.id === l.groupId); return g ? g.nature : ''; };

  /* accounts */
  const accLedger = new Map(); /* old account id -> { owner, ledger } */
  for (const a of s.accounts) {
    const o = ownerKey(ownerOfAccount(s, a.id));
    const mapped = mapping['acc:' + a.id] && ent(o).ledgers.find(l => l.id === mapping['acc:' + a.id]);
    const l = mapped || addLedger(o, ACC_GROUP[a.type] || 'bank', a.name, { note: 'From DoctorWealth' });
    addOpening(l.id, num(a.opening));
    accLedger.set(a.id, { owner: o, ledger: l });
  }
  const accOf = id => accLedger.get(id) || null;

  /* categories (lazily per entity) */
  const catCache = new Map();
  const incomeLedger = (o, catId) => {
    const key = o + ':inc:' + catId; if (catCache.has(key)) return catCache.get(key);
    const c = s.incomeCats.find(x => x.id === catId);
    let l = mapping[key] && ent(o).ledgers.find(x => x.id === mapping[key]);
    if (!l) { const it = incomeTag(c && c.group, c && c.name); l = ensure(o, it.gk, c ? c.name : 'Other Income', { taxTag: it.tag }); }
    catCache.set(key, l); return l;
  };
  const expenseLedger = (o, catId) => {
    const key = o + ':exp:' + catId; if (catCache.has(key)) return catCache.get(key);
    const c = s.expenseCats.find(x => x.id === catId);
    let l = mapping[key] && ent(o).ledgers.find(x => x.id === mapping[key]);
    if (!l) { const et = expenseTag(c && c.group); l = ensure(o, et.gk, c ? c.name : 'Miscellaneous', { taxTag: et.tag }); }
    catCache.set(key, l); return l;
  };

  /* loans */
  const loanInfo = new Map();
  for (const ln of s.loans) {
    const o = ownerKey(ln.linkedAccountId ? ownerOfAccount(s, ln.linkedAccountId) : 'me');
    const l = addLedger(o, 'loans', ln.name || 'Loan', { note: 'From DoctorWealth' + (ln.rate ? ` · ${ln.rate}% p.a.` : '') });
    addOpening(l.id, -num(ln.outstanding));
    const intName = ln.type === 'home' ? 'Home Loan Interest' : ln.type === 'vehicle' ? 'Car Loan Interest' : 'Loan Interest';
    const il = ensure(o, 'finexp', intName, { taxTag: ln.type === 'home' ? 'home_loan_interest' : 'personal' });
    loanInfo.set(ln.id, { owner: o, ledger: l, interest: il });
  }

  /* pay something in entity `target` from an account owned by `payer` (cross-entity aware) */
  const settle = (payerAcc, target, debitLines, total, base) => {
    if (!payerAcc) { push(target, { ...base, lines: [...debitLines, { ledgerId: suspense(target).id, cr: total }] }); return; }
    if (payerAcc.owner === target) { push(target, { ...base, lines: [...debitLines, { ledgerId: payerAcc.ledger.id, cr: total }] }); return; }
    push(target, { ...base, lines: [...debitLines, { ledgerId: inter(target, payerAcc.owner).id, cr: total }] });
    push(payerAcc.owner, { ...base, type: 'journal', lines: [{ ledgerId: inter(payerAcc.owner, target).id, dr: total }, { ledgerId: payerAcc.ledger.id, cr: total }] });
  };

  /* income */
  for (const x of s.income) {
    const acc = accOf(x.accountId);
    const earner = ownerKey(x.owner === 'spouse' ? 'spouse' : x.owner === 'me' ? 'me' : acc ? acc.owner : 'me');
    const net = num(x.amount); if (!net) continue;
    const tds = incomeTds(x), gross = net + tds;
    const il = incomeLedger(earner, x.catId);
    const narration = [x.note, x.opdLoc ? 'OPD: ' + x.opdLoc : ''].filter(Boolean).join(' · ');
    const mode = x.cash ? 'cash' : (acc && moneyType(acc.owner, acc.ledger) === 'cash' ? 'cash' : 'digital');
    const base = { type: 'receipt', date: dateOf(x.date, (x.created || '').slice(0, 10)), narration, meta: { mode }, legacyId: x.id };
    let moneyLine;
    if (!acc) moneyLine = { ledgerId: suspense(earner).id, dr: net };
    else if (acc.owner === earner) moneyLine = { ledgerId: acc.ledger.id, dr: net };
    else {
      moneyLine = { ledgerId: inter(earner, acc.owner).id, dr: net };
      push(acc.owner, { ...base, type: 'journal', meta: {}, lines: [{ ledgerId: acc.ledger.id, dr: net }, { ledgerId: inter(acc.owner, earner).id, cr: net }] });
    }
    push(earner, { ...base, lines: [moneyLine, tds ? { ledgerId: tdsL(earner).id, dr: tds } : null, { ledgerId: il.id, cr: gross }].filter(Boolean) });
  }

  /* expenses (EMIs linked to a loan split into principal + interest) */
  for (const e of s.expenses) {
    const amt = num(e.amount); if (!amt) continue;
    const acc = accOf(e.accountId);
    const base = { type: 'payment', date: dateOf(e.date, (e.created || '').slice(0, 10)), narration: e.note || '', legacyId: e.id };
    const li = e.loanId && loanInfo.get(e.loanId);
    if (li) {
      const interest = Math.min(amt, num(e.interest));
      settle(acc, li.owner, [{ ledgerId: li.ledger.id, dr: amt - interest }, { ledgerId: li.interest.id, dr: interest }], amt, base);
    } else {
      const o = acc ? acc.owner : ownerKey('me');
      settle(acc, o, [{ ledgerId: expenseLedger(o, e.catId).id, dr: amt }], amt, base);
    }
  }

  /* transfers */
  for (const t of s.transfers) {
    const amt = num(t.amount); if (!amt) continue;
    const from = accOf(t.fromId), to = accOf(t.toId);
    const base = { type: 'contra', date: dateOf(t.date, (t.created || '').slice(0, 10)), narration: t.note || '', legacyId: t.id };
    if (!from && !to) continue;
    if (!to) { settle(from, from.owner, [{ ledgerId: suspense(from.owner).id, dr: amt }], amt, base); continue; }
    settle(from, to.owner, [{ ledgerId: to.ledger.id, dr: amt }], amt, base);
  }

  /* investments: funded ones move money; unfunded ones become opening balances at cost */
  for (const iv of s.investments) {
    if (iv.archived) continue;
    const cost = investmentCost(iv);
    const fund = iv.fundFrom ? accOf(iv.fundFrom) : null;
    const o = fund ? fund.owner : ownerKey('me');
    const il = ensure(o, INV_LEDGER(iv.type) === 'Real Estate' ? 'fixed' : 'invest', INV_LEDGER(iv.type));
    if (cost > 0) {
      if (fund) push(o, { type: 'payment', date: dateOf(iv.sipLastPosted, iv.sipStart, (iv.created || '').slice(0, 10)), narration: 'Investment: ' + iv.name + (iv.sip ? ' (SIP)' : ''), lines: [{ ledgerId: il.id, dr: cost }, { ledgerId: fund.ledger.id, cr: cost }], legacyId: iv.id });
      else addOpening(il.id, cost);
    }
    plan.holdings.push({ id: uid('hld'), entityId: ent(o).entity.id, ledgerId: il.id, name: iv.name, type: iv.type || '', qty: num(iv.qty), avg: num(iv.avg), ltp: num(iv.price), cost, value: investmentValue(iv), broker: iv.broker || '', source: 'legacy', asOf: today(), createdAt: nowISO() });
  }

  /* loan drawdowns / repayments recorded in the loan ledger */
  for (const lp of s.loanLedger) {
    const li = loanInfo.get(lp.loanId); if (!li) continue;
    const acc = accOf(lp.accountId); const amt = num(lp.amount); if (!amt) continue;
    const base = { date: dateOf(lp.date, (lp.created || '').slice(0, 10)), narration: lp.kind === 'draw' ? 'Loan drawdown' : 'Loan repayment', legacyId: lp.id };
    if (lp.kind === 'draw') {
      if (acc && acc.owner === li.owner) push(li.owner, { ...base, type: 'receipt', lines: [{ ledgerId: acc.ledger.id, dr: amt }, { ledgerId: li.ledger.id, cr: amt }] });
      else if (acc) {
        push(li.owner, { ...base, type: 'journal', lines: [{ ledgerId: inter(li.owner, acc.owner).id, dr: amt }, { ledgerId: li.ledger.id, cr: amt }] });
        push(acc.owner, { ...base, type: 'journal', lines: [{ ledgerId: acc.ledger.id, dr: amt }, { ledgerId: inter(acc.owner, li.owner).id, cr: amt }] });
      } else push(li.owner, { ...base, type: 'journal', lines: [{ ledgerId: suspense(li.owner).id, dr: amt }, { ledgerId: li.ledger.id, cr: amt }] });
    } else {
      const interest = Math.min(amt, num(lp.interest));
      settle(acc, li.owner, [{ ledgerId: li.ledger.id, dr: amt - interest }, { ledgerId: li.interest.id, dr: interest }], amt, { ...base, type: 'payment' });
    }
  }

  /* sites, rules, tax P&L */
  const meSites = (ent('me').entity.sites || []).map(x => x.name.toLowerCase());
  for (const h of s.hospitals) if (h && h.name && !meSites.includes(h.name.toLowerCase())) plan.sites.push(h.name);
  for (const r of s.rules) {
    if (!r || !r.pattern) continue;
    const isInc = r.kind === 'income';
    const l = isInc ? incomeLedger('me', r.catId) : expenseLedger('me', r.catId);
    plan.rules.push({ id: uid('rul'), entityId: ent('me').entity.id, pattern: r.pattern, ledgerId: l.id, dir: isInc ? 'credit' : r.kind === 'expense' ? 'debit' : 'any', off: !!r.off, createdAt: nowISO() });
  }
  for (const t of s.taxPnl) {
    const o = ownerKey(t.owner === 'spouse' ? 'spouse' : 'me');
    plan.taxPnl.push({ id: uid('tpl'), entityId: ent(o).entity.id, fy: t.fy, stcg: num(t.stcg), ltcg: num(t.ltcg), intraday: num(t.intraday), nonEquity: num(t.nonEquity), foOptions: num(t.foOptions), foFutures: num(t.foFutures), dividends: num(t.dividends), ledgerClose: t.ledgerClose == null ? null : num(t.ledgerClose), file: t.file || 'DoctorWealth', source: 'legacy', createdAt: nowISO() });
  }
  if (s.opd.some(o => num(o.fuel) + num(o.driver) + num(o.food) + num(o.other) > 0))
    plan.warnings.push('OPD camp running costs (fuel, driver, food) were only notes in the old app, not account entries, so they are not posted. Add them as expenses if they were paid.');
  if (s.goals && s.goals.length) plan.warnings.push(`${s.goals.length} goal(s) are not migrated (not part of the books).`);

  /* verification: per new ledger, expected movement from old balances vs movement produced by the plan */
  const oldBal = legacyBalances(s);
  const expected = new Map();
  for (const a of s.accounts) { const al = accOf(a.id); expected.set(al.ledger.id, (expected.get(al.ledger.id) || 0) + oldBal.get(a.id)); }
  const actual = new Map();
  for (const [id, d] of plan.openingDeltas) actual.set(id, (actual.get(id) || 0) + d);
  for (const v of plan.vouchers) for (const ln of v.lines) if (expected.has(ln.ledgerId)) actual.set(ln.ledgerId, (actual.get(ln.ledgerId) || 0) + (ln.dr || 0) - (ln.cr || 0));
  for (const a of s.accounts) {
    const al = accOf(a.id);
    plan.checks.push({ name: a.name, owner: al.owner, ledger: al.ledger, old: oldBal.get(a.id), expected: expected.get(al.ledger.id), actual: actual.get(al.ledger.id) || 0 });
  }
  plan.counts = { accounts: s.accounts.length, income: s.income.length, expenses: s.expenses.length, transfers: s.transfers.length, investments: s.investments.length, loans: s.loans.length };
  return plan;
}
