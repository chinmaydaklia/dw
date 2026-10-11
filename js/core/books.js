/* The accounting engine. Pure functions over an entity's masters and vouchers.
   Convention: a ledger's balance is signed Dr-positive (assets/expenses normally +, liabilities/capital/income −).
   Every voucher line carries exactly one of dr / cr as a positive integer of paise. */
import { MONEY_NATURES, ROOT_ORDER } from './masters.js';
import { monthsBetween, monthEnd, addDays } from '../lib/dates.js';

export function makeCtx({ entity, groups, ledgers, vouchers }) {
  const gById = new Map(groups.map(g => [g.id, g]));
  const lById = new Map(ledgers.map(l => [l.id, l]));
  const capital = ledgers.find(l => l.system === 'capital') || null;
  const ctx = {
    entity, groups, ledgers, vouchers, gById, lById, capital,
    groupOf: l => gById.get(l.groupId),
    rootOf: l => { const g = gById.get(l.groupId); return g ? g.root : 'asset'; },
    natureOf: l => { const g = gById.get(l.groupId); return g ? g.nature : ''; },
    isMoney: id => { const l = lById.get(id); return !!l && MONEY_NATURES.has(ctx.natureOf(l)); }
  };
  return ctx;
}

export const lineAmt = ln => (ln.dr || 0) - (ln.cr || 0);
export const voucherTotal = v => v.lines.reduce((t, l) => t + (l.dr || 0), 0);
export function isBalanced(v) {
  let d = 0, c = 0;
  for (const l of v.lines) { d += l.dr || 0; c += l.cr || 0; }
  return d === c && d > 0;
}

/* Opening capital is the balancing figure of all other opening balances, so the books always open balanced
   (net worth on day one = assets − liabilities). */
export function openingOf(ctx, ledger) {
  if (ctx.capital && ledger.id === ctx.capital.id) {
    let t = 0; for (const l of ctx.ledgers) if (l.id !== ledger.id) t += l.opening || 0;
    return -t;
  }
  return ledger.opening || 0;
}

/* Map ledgerId -> { opening, dr, cr, closing } for the period [from, to] (either may be empty). */
export function balances(ctx, { from = '', to = '' } = {}) {
  const m = new Map();
  for (const l of ctx.ledgers) m.set(l.id, { opening: openingOf(ctx, l), dr: 0, cr: 0, closing: 0 });
  for (const v of ctx.vouchers) {
    if (to && v.date > to) continue;
    const before = from && v.date < from;
    for (const ln of v.lines) {
      const b = m.get(ln.ledgerId); if (!b) continue;
      if (before) b.opening += lineAmt(ln);
      else { b.dr += ln.dr || 0; b.cr += ln.cr || 0; }
    }
  }
  for (const b of m.values()) b.closing = b.opening + b.dr - b.cr;
  return m;
}

function sortedGroups(ctx) {
  return ctx.groups.slice().sort((a, b) => ROOT_ORDER.indexOf(a.root) - ROOT_ORDER.indexOf(b.root) || a.order - b.order || a.name.localeCompare(b.name));
}
function ledgersOf(ctx, groupId) {
  return ctx.ledgers.filter(l => l.groupId === groupId).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/* Trial balance as at `to` (closing balances), with optional period movement. */
export function trialBalance(ctx, { from = '', to = '' } = {}) {
  const bal = balances(ctx, { from, to });
  const groups = [];
  let totDr = 0, totCr = 0;
  for (const g of sortedGroups(ctx)) {
    const rows = [];
    for (const l of ledgersOf(ctx, g.id)) {
      const b = bal.get(l.id);
      if (!b.closing && !b.dr && !b.cr && !b.opening) continue;
      rows.push({ ledger: l, ...b });
      if (b.closing > 0) totDr += b.closing; else totCr += -b.closing;
    }
    if (rows.length) groups.push({ group: g, rows, closing: rows.reduce((t, r) => t + r.closing, 0) });
  }
  return { groups, totDr, totCr, diff: totDr - totCr };
}

/* Profit & loss (income & expenditure) for a period, group-wise, plus the professional summary. */
export function profitLoss(ctx, { from = '', to = '' } = {}) {
  const bal = balances(ctx, { from, to });
  const income = [], expense = [];
  let totalIncome = 0, totalExpense = 0;
  const prof = { receipts: 0, expenses: 0 };
  for (const g of sortedGroups(ctx)) {
    if (g.root !== 'income' && g.root !== 'expense') continue;
    const rows = [];
    for (const l of ledgersOf(ctx, g.id)) {
      const b = bal.get(l.id);
      const amt = g.root === 'income' ? b.cr - b.dr : b.dr - b.cr;
      if (!amt) continue;
      rows.push({ ledger: l, amount: amt });
      if (l.taxTag === 'prof_receipts') prof.receipts += amt;
      if (l.taxTag === 'prof_expense' || l.taxTag === 'depreciation') prof.expenses += amt;
    }
    if (!rows.length) continue;
    const total = rows.reduce((t, r) => t + r.amount, 0);
    (g.root === 'income' ? income : expense).push({ group: g, rows, total });
    if (g.root === 'income') totalIncome += total; else totalExpense += total;
  }
  prof.net = prof.receipts - prof.expenses;
  return { income, expense, totalIncome, totalExpense, surplus: totalIncome - totalExpense, prof };
}

/* Surplus (income − expense) from inception up to and including `to`. */
export function surplusTo(ctx, to) {
  let s = 0;
  for (const v of ctx.vouchers) {
    if (to && v.date > to) continue;
    for (const ln of v.lines) {
      const l = ctx.lById.get(ln.ledgerId); if (!l) continue;
      const r = ctx.rootOf(l);
      if (r === 'income' || r === 'expense') s -= lineAmt(ln);
    }
  }
  return s;
}

/* Balance sheet as at `asOf`. periodFrom = start of the current year (for the capital roll-forward). */
export function balanceSheet(ctx, { asOf, periodFrom }) {
  const bal = balances(ctx, { to: asOf });
  const side = { asset: [], liability: [] };
  let totA = 0, totL = 0;
  let capitalLedgers = 0;
  for (const g of sortedGroups(ctx)) {
    if (g.root === 'capital') {
      for (const l of ledgersOf(ctx, g.id)) capitalLedgers += -bal.get(l.id).closing;
      continue;
    }
    if (g.root !== 'asset' && g.root !== 'liability') continue;
    const rows = [];
    for (const l of ledgersOf(ctx, g.id)) {
      const c = bal.get(l.id).closing;
      const amt = g.root === 'asset' ? c : -c;
      if (!amt) continue;
      rows.push({ ledger: l, amount: amt });
    }
    if (!rows.length) continue;
    const total = rows.reduce((t, r) => t + r.amount, 0);
    side[g.root].push({ group: g, rows, total });
    if (g.root === 'asset') totA += total; else totL += total;
  }
  const prior = periodFrom ? surplusTo(ctx, addDays(periodFrom, -1)) : 0;
  const upto = surplusTo(ctx, asOf);
  const capital = {
    ledgers: capitalLedgers,           /* opening capital ± capital introduced / withdrawn */
    accumulated: prior,                /* surplus of earlier years */
    current: upto - prior,             /* surplus of this period */
    total: capitalLedgers + upto
  };
  return { assets: side.asset, liabilities: side.liability, capital, totalAssets: totA, totalLiabilities: totL + capital.total, diff: totA - (totL + capital.total) };
}

/* Account statement with running balance and Tally-style "particulars" (the other side). */
export function ledgerStatement(ctx, ledgerId, { from = '', to = '' } = {}) {
  const l = ctx.lById.get(ledgerId);
  let opening = l ? openingOf(ctx, l) : 0;
  const rows = [];
  const vs = ctx.vouchers.filter(v => (!to || v.date <= to) && v.lines.some(x => x.ledgerId === ledgerId))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''));
  let run = 0, dr = 0, cr = 0;
  for (const v of vs) {
    let amt = 0;
    for (const ln of v.lines) if (ln.ledgerId === ledgerId) amt += lineAmt(ln);
    if (from && v.date < from) { opening += amt; continue; }
    if (!rows.length) run = opening;
    run += amt;
    if (amt > 0) dr += amt; else cr += -amt;
    rows.push({ voucher: v, date: v.date, particulars: particulars(ctx, v, ledgerId), dr: amt > 0 ? amt : 0, cr: amt < 0 ? -amt : 0, balance: run });
  }
  return { ledger: l, opening, rows, dr, cr, closing: opening + dr - cr };
}
export function particulars(ctx, v, ledgerId) {
  const mine = v.lines.filter(x => x.ledgerId === ledgerId).reduce((t, x) => t + lineAmt(x), 0);
  const others = v.lines.filter(x => x.ledgerId !== ledgerId && Math.sign(lineAmt(x)) !== Math.sign(mine));
  const names = [...new Set(others.map(x => (ctx.lById.get(x.ledgerId) || {}).name || '?'))];
  if (!names.length) return '(self)';
  return names.length === 1 ? names[0] : names[0] + ' +' + (names.length - 1);
}

export function dayBook(ctx, { from = '', to = '' } = {}) {
  return ctx.vouchers.filter(v => (!from || v.date >= from) && (!to || v.date <= to))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/* Cash-flow statement (direct method) over cash + bank ledgers.
   Each voucher's net cash movement is allocated to its non-cash lines in proportion. */
const CF_CLASS = { income: 'operating', expense: 'operating', card: 'operating', payable: 'operating', taxasset: 'operating',
  investment: 'investing', fixed: 'investing', advance: 'investing', loan: 'financing', capital: 'financing' };
export function cashFlow(ctx, { from = '', to = '' } = {}) {
  const sections = { operating: new Map(), investing: new Map(), financing: new Map() };
  let opening = 0, closing = 0;
  for (const l of ctx.ledgers) if (ctx.isMoney(l.id)) opening += openingOf(ctx, l);
  closing = opening;
  for (const v of ctx.vouchers) {
    if (to && v.date > to) continue;
    let cash = 0;
    const others = [];
    for (const ln of v.lines) { if (ctx.isMoney(ln.ledgerId)) cash += lineAmt(ln); else others.push(ln); }
    if (from && v.date < from) { opening += cash; closing += cash; continue; }
    closing += cash;
    if (!cash || !others.length) continue;
    const base = others.reduce((t, ln) => t + lineAmt(ln), 0); /* equals −cash */
    let allocated = 0;
    others.forEach((ln, i) => {
      const share = i === others.length - 1 ? cash - allocated : Math.round(cash * lineAmt(ln) / base);
      allocated += share;
      const l = ctx.lById.get(ln.ledgerId); if (!l) return;
      const g = ctx.groupOf(l) || {};
      const cls = CF_CLASS[g.root === 'income' || g.root === 'expense' ? g.root : g.nature] || (g.root === 'capital' ? 'financing' : 'operating');
      const key = g.id || '?';
      const cur = sections[cls].get(key) || { group: g, inflow: 0, outflow: 0 };
      if (share > 0) cur.inflow += share; else cur.outflow += -share;
      sections[cls].set(key, cur);
    });
  }
  const out = {};
  let net = 0;
  for (const k of Object.keys(sections)) {
    const rows = [...sections[k].values()].sort((a, b) => (b.inflow - b.outflow) - (a.inflow - a.outflow));
    const total = rows.reduce((t, r) => t + r.inflow - r.outflow, 0);
    out[k] = { rows, total }; net += total;
  }
  return { ...out, opening, closing, net, check: opening + net - closing };
}

/* Month-end net worth (assets − liabilities) series. */
export function netWorthSeries(ctx, { from, to }) {
  const isBS = l => { const r = ctx.rootOf(l); return r === 'asset' || r === 'liability'; };
  let base = 0;
  for (const l of ctx.ledgers) if (isBS(l)) base += openingOf(ctx, l);
  const byMonth = new Map();
  for (const v of ctx.vouchers) {
    let d = 0;
    for (const ln of v.lines) { const l = ctx.lById.get(ln.ledgerId); if (l && isBS(l)) d += lineAmt(ln); }
    if (!d) continue;
    if (v.date < from) { base += d; continue; }
    if (v.date > to) continue;
    const k = v.date.slice(0, 7); byMonth.set(k, (byMonth.get(k) || 0) + d);
  }
  let run = base;
  return monthsBetween(from, to).map(k => { run += byMonth.get(k) || 0; return { month: k, date: monthEnd(k + '-01'), value: run }; });
}

/* Income / expense analysis by a dimension. by: 'site' | 'ledger' | 'group' | 'tag' | 'owner' | 'custom' | 'month' */
export function analysis(ctx, { from = '', to = '', by = 'site' } = {}) {
  const rows = new Map();
  const siteName = id => ((ctx.entity.sites || []).find(s => s.id === id) || {}).name || '';
  for (const v of ctx.vouchers) {
    if ((from && v.date < from) || (to && v.date > to)) continue;
    for (const ln of v.lines) {
      const l = ctx.lById.get(ln.ledgerId); if (!l) continue;
      const root = ctx.rootOf(l);
      if (root !== 'income' && root !== 'expense') continue;
      const amt = root === 'income' ? -lineAmt(ln) : lineAmt(ln);
      let keys;
      switch (by) {
        case 'site': keys = [siteName((v.tags && v.tags.siteId) || l.siteId) || '(no site)']; break;
        case 'ledger': keys = [l.name]; break;
        case 'group': keys = [(ctx.groupOf(l) || {}).name || '?']; break;
        case 'tag': keys = [l.taxTag || 'none']; break;
        case 'owner': keys = [(v.tags && v.tags.owner) || '(none)']; break;
        case 'custom': keys = (v.tags && v.tags.custom && v.tags.custom.length) ? v.tags.custom : ['(untagged)']; break;
        case 'month': keys = [v.date.slice(0, 7)]; break;
        default: keys = ['all'];
      }
      for (const k of keys) {
        const r = rows.get(k) || { key: k, income: 0, expense: 0, count: 0, visits: 0 };
        if (root === 'income') r.income += amt; else r.expense += amt;
        rows.set(k, r);
      }
    }
    if (v.meta && v.meta.visits) {
      const l0 = ctx.lById.get((v.lines.find(x => (x.cr || 0) > 0) || {}).ledgerId);
      if (by === 'site') { const k = siteName((v.tags && v.tags.siteId) || (l0 && l0.siteId)) || '(no site)'; const r = rows.get(k); if (r) r.visits += v.meta.visits; }
    }
    const k0 = by === 'month' ? v.date.slice(0, 7) : null;
    if (k0 && rows.get(k0)) rows.get(k0).count++;
  }
  const list = [...rows.values()];
  for (const r of list) r.net = r.income - r.expense;
  list.sort((a, b) => by === 'month' ? a.key.localeCompare(b.key) : (b.income + b.expense) - (a.income + a.expense));
  return list;
}

/* Cash vs digital split of professional receipts (drives the presumptive-scheme limit checks).
   Cash portion of a receipt = debits to Cash-in-Hand ledgers in that voucher (or an explicit meta.mode). */
export function cashDigital(ctx, { from = '', to = '' } = {}) {
  let cash = 0, digital = 0;
  const months = new Map();
  for (const v of ctx.vouchers) {
    if ((from && v.date < from) || (to && v.date > to)) continue;
    let prof = 0, cashDr = 0;
    for (const ln of v.lines) {
      const l = ctx.lById.get(ln.ledgerId); if (!l) continue;
      if (l.taxTag === 'prof_receipts') prof += (ln.cr || 0) - (ln.dr || 0);
      if (ctx.natureOf(l) === 'cash') cashDr += ln.dr || 0;
    }
    if (prof <= 0) continue;
    let c = v.meta && v.meta.mode === 'cash' ? prof : v.meta && v.meta.mode === 'digital' ? 0 : Math.min(prof, cashDr);
    cash += c; digital += prof - c;
    const k = v.date.slice(0, 7); const m = months.get(k) || { month: k, cash: 0, digital: 0 };
    m.cash += c; m.digital += prof - c; months.set(k, m);
  }
  const total = cash + digital;
  return { cash, digital, total, cashPct: total ? cash / total : 0, months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)) };
}

/* Headline figures for the dashboard. */
export function headline(ctx, { asOf, from }) {
  const bal = balances(ctx, { to: asOf });
  const t = { cash: 0, bank: 0, investments: 0, otherAssets: 0, loans: 0, cards: 0, otherLiab: 0 };
  for (const l of ctx.ledgers) {
    const c = bal.get(l.id).closing; if (!c) continue;
    const g = ctx.groupOf(l) || {};
    if (g.nature === 'cash') t.cash += c;
    else if (g.nature === 'bank') t.bank += c;
    else if (g.nature === 'investment') t.investments += c;
    else if (g.root === 'asset') t.otherAssets += c;
    else if (g.nature === 'loan') t.loans += -c;
    else if (g.nature === 'card') t.cards += -c;
    else if (g.root === 'liability') t.otherLiab += -c;
  }
  t.assets = t.cash + t.bank + t.investments + t.otherAssets;
  t.liabilities = t.loans + t.cards + t.otherLiab;
  t.netWorth = t.assets - t.liabilities;
  const pl = profitLoss(ctx, { from, to: asOf });
  t.income = pl.totalIncome; t.expense = pl.totalExpense; t.surplus = pl.surplus; t.prof = pl.prof;
  return t;
}

/* Family view: combine several entities, eliminating inter-entity current accounts (they net to zero). */
export function family(ctxs, { asOf, from }) {
  const per = ctxs.map(ctx => {
    const h = headline(ctx, { asOf, from });
    const bal = balances(ctx, { to: asOf });
    let inter = 0;
    for (const l of ctx.ledgers) if (l.interEntityWith) inter += bal.get(l.id).closing;
    return { entity: ctx.entity, ...h, inter };
  });
  const sumK = k => per.reduce((t, p) => t + p[k], 0);
  const keys = ['cash', 'bank', 'investments', 'otherAssets', 'loans', 'cards', 'otherLiab', 'income', 'expense', 'surplus'];
  const total = Object.fromEntries(keys.map(k => [k, sumK(k)]));
  const inter = sumK('inter');
  total.netWorth = sumK('netWorth') - inter; /* inter-entity balances cancel out on consolidation */
  total.interEntityDifference = inter;
  return { per, total };
}
