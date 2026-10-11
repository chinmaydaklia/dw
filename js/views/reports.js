/* Core reports. Every total drills down to the ledger, and every ledger line to its voucher. */
import { h, clear, money, amt, drcr, add } from '../ui/dom.js';
import { exportTable, xr, select } from '../ui/widgets.js';
import { periodControl, currentPeriod, priorPeriod, period } from '../ui/pickers.js';
import * as store from '../app/store.js';
import { trialBalance, profitLoss, balanceSheet, cashFlow, netWorthSeries, analysis, cashDigital, family, makeCtx } from '../core/books.js';
import { TAX_TAGS, ROOTS } from '../core/masters.js';
import { lineChart, barChart } from '../ui/charts.js';
import { fmtDate, fmtMonth, today, fyOf, fyRange } from '../lib/dates.js';

const TITLE = { tb: 'Trial balance', pl: 'Profit & loss', bs: 'Balance sheet', cf: 'Cash flow statement', networth: 'Net worth over time', analysis: 'Analysis', cash: 'Cash vs digital receipts', family: 'Family view' };
const goLedger = id => { location.hash = '#/ledger/' + id; };

export function renderReport(root, name) {
  const out = h('div');
  const exp = h('span.btnrow');
  const extra = h('span.btnrow');
  add(root, h('div.toolbar', periodControl(draw, { allowCompare: name === 'pl' }), extra, h('span.spacer'), exp), out);
  const R = { tb, pl, bs, cf, networth, analysis: an, cash, family: fam }[name];
  function draw() {
    const p = currentPeriod();
    clear(out); clear(exp);
    add(out, h('div.print-head', h('h2', TITLE[name]), h('div', (name === 'family' ? 'Family' : store.activeEntity().name) + ' · ' + p.label)));
    R(out, p, exp, extra, draw);
  }
  draw();
}
const asOfOf = p => (p.to < today() ? p.to : (p.from > today() ? p.to : today()));

/* ---------- trial balance ---------- */
function tb(out, p, exp) {
  const c = store.ctx();
  const asOf = p.to;
  const t = trialBalance(c, { from: p.from, to: asOf });
  const rows = [];
  for (const g of t.groups) {
    rows.push(h('tr.grp', h('td', ROOTS[g.group.root].name + ' › ' + g.group.name), h('td.r.hide-sm'), h('td.r.hide-sm'), h('td.r.amt', g.closing > 0 ? money(g.closing) : ''), h('td.r.amt', g.closing < 0 ? money(-g.closing) : '')));
    for (const r of g.rows) rows.push(h('tr.click', { onclick: () => goLedger(r.ledger.id) }, h('td.ind', r.ledger.name), h('td.r.amt.hide-sm', drcr(r.opening)), h('td.r.amt.hide-sm', money(r.dr - r.cr, { sign: true })), h('td.r.amt', r.closing > 0 ? money(r.closing) : ''), h('td.r.amt', r.closing < 0 ? money(-r.closing) : '')));
  }
  add(exp, ...exportTable('Trial balance ' + asOf, ['Group', 'Ledger', 'Opening', 'Movement', 'Debit', 'Credit'], t.groups.flatMap(g => g.rows.map(r => [g.group.name, r.ledger.name, xr(r.opening), xr(r.dr - r.cr), r.closing > 0 ? xr(r.closing) : '', r.closing < 0 ? xr(-r.closing) : '']))));
  add(out, h('div', { class: 'note ' + (t.diff === 0 ? 'ok' : 'bad'), style: { marginBottom: '12px' } }, t.diff === 0 ? '✓ Trial balance tallies — total debits equal total credits as at ' + fmtDate(asOf) + '.' : '⚠ Out by ' + money(Math.abs(t.diff)) + '. See Health.'),
    h('div.card', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Particulars'), h('th.r.hide-sm', 'Opening ' + fmtDate(p.from)), h('th.r.hide-sm', 'Movement'), h('th.r', 'Debit'), h('th.r', 'Credit'))), h('tbody', rows),
      h('tfoot', h('tr.tot', h('td', 'Total'), h('td.hide-sm'), h('td.hide-sm'), h('td.r.amt', money(t.totDr)), h('td.r.amt', money(t.totCr))))))));
}

/* ---------- profit & loss ---------- */
function pl(out, p, exp) {
  const c = store.ctx();
  const r = profitLoss(c, p);
  const cmpP = period.compare ? priorPeriod(p) : null;
  const cmp = cmpP ? profitLoss(c, cmpP) : null;
  const prevOf = (lid) => { if (!cmp) return null; for (const s of [...cmp.income, ...cmp.expense]) for (const x of s.rows) if (x.ledger.id === lid) return x.amount; return 0; };
  const prevGroup = (gid, side) => { if (!cmp) return null; const s = cmp[side].find(x => x.group.id === gid); return s ? s.total : 0; };
  const row = (label, val, cls, onclick, prev) => h('div.stmt-row' + (cls ? '.' + cls : '') + (onclick ? '.click' : ''), { onclick }, h('span', label), h('span.btnrow', { style: { gap: '14px', flexWrap: 'nowrap' } }, cmp ? h('span.cmp.amt', prev === null ? '' : money(prev)) : null, h('span.amt', money(val))));
  const side = (title, sections, total, key, prevTotal) => h('div.card', h('div.card-h', h('h3', title), cmp ? h('span.sub', { style: { marginLeft: 'auto' } }, cmpP.label + ' | ' + p.label) : null), h('div.card-b',
    sections.length ? sections.map(s => [row(s.group.name, s.total, 'grp', null, prevGroup(s.group.id, key)), ...s.rows.map(x => row(x.ledger.name, x.amount, 'led', () => goLedger(x.ledger.id), prevOf(x.ledger.id)))]) : h('div.muted.small', 'Nothing in this period.'),
    row('Total ' + title.toLowerCase(), total, 'tot', null, prevTotal)));
  add(out, h('div.stmt', side('Income', r.income, r.totalIncome, 'income', cmp && cmp.totalIncome), side('Expenses', r.expense, r.totalExpense, 'expense', cmp && cmp.totalExpense)));
  add(out, h('div.card', { style: { marginTop: '14px' } }, h('div.card-b', { style: { paddingTop: '12px' } },
    row(r.surplus >= 0 ? 'Surplus for the period (added to capital)' : 'Deficit for the period', r.surplus, 'tot', null, cmp && cmp.surplus))));
  const pr = r.prof;
  add(out, h('div.card', { style: { marginTop: '14px' } }, h('div.card-h', h('h3', 'Professional income summary'), h('span.sub', 'basis for ITR-3 business & profession schedule')), h('div.card-b',
    row('Gross professional receipts', pr.receipts, '', null, cmp && cmp.prof.receipts),
    row('Professional expenses (deductible)', pr.expenses, '', null, cmp && cmp.prof.expenses),
    row('Net professional income — actual basis', pr.net, 'tot', null, cmp && cmp.prof.net),
    row('Deemed profit at 50% (presumptive, Sec 58 / 44ADA) — reference', Math.round(pr.receipts / 2), '', null, cmp && Math.round(cmp.prof.receipts / 2)),
    h('p.small.muted', 'Declaring less than 50% under the presumptive scheme requires books and a tax audit when income exceeds the exemption limit. The full regime comparison and eligibility checks arrive in Phase 3.'))));
  const lines = [];
  for (const [k, secs] of [['Income', r.income], ['Expense', r.expense]]) for (const s of secs) for (const x of s.rows) lines.push([k, s.group.name, x.ledger.name, TAX_TAGS[x.ledger.taxTag] ? TAX_TAGS[x.ledger.taxTag].label : '', xr(x.amount), cmp ? xr(prevOf(x.ledger.id) || 0) : '']);
  add(exp, ...exportTable('Profit and loss ' + p.label, ['Side', 'Group', 'Ledger', 'Tax tag', p.label, cmp ? cmpP.label : ''], lines));
}

/* ---------- balance sheet ---------- */
function bs(out, p, exp) {
  const c = store.ctx();
  const asOf = asOfOf(p);
  const b = balanceSheet(c, { asOf, periodFrom: p.from });
  const row = (label, val, cls, onclick) => h('div.stmt-row' + (cls ? '.' + cls : '') + (onclick ? '.click' : ''), { onclick }, h('span', label), h('span.amt', money(val)));
  const block = sections => sections.map(s => [row(s.group.name, s.total, 'grp'), ...s.rows.map(x => row(x.ledger.name, x.amount, 'led', () => goLedger(x.ledger.id)))]);
  const cap = b.capital;
  add(out, h('p.muted', { style: { marginTop: 0 } }, 'As at ' + fmtDate(asOf)),
    h('div.stmt',
      h('div.card', h('div.card-h', h('h3', 'Capital & liabilities')), h('div.card-b',
        row('Capital account', cap.total, 'grp'),
        row('Opening capital & capital movements', cap.ledgers, 'led', c.capital ? () => goLedger(c.capital.id) : null),
        row('Surplus of earlier periods', cap.accumulated, 'led'),
        row('Surplus for this period', cap.current, 'led', () => { location.hash = '#/pl'; }),
        block(b.liabilities), row('Total', b.totalLiabilities, 'tot'))),
      h('div.card', h('div.card-h', h('h3', 'Assets')), h('div.card-b', block(b.assets), row('Total', b.totalAssets, 'tot')))),
    h('div', { class: 'note ' + (b.diff === 0 ? 'ok' : 'bad'), style: { marginTop: '12px' } }, b.diff === 0 ? '✓ Balance sheet tallies.' : '⚠ Difference of ' + money(b.diff) + '.'));
  const lines = [['Capital', 'Capital account', xr(cap.total)], ...b.liabilities.flatMap(s => s.rows.map(x => ['Liability', s.group.name + ' › ' + x.ledger.name, xr(x.amount)])), ...b.assets.flatMap(s => s.rows.map(x => ['Asset', s.group.name + ' › ' + x.ledger.name, xr(x.amount)]))];
  add(exp, ...exportTable('Balance sheet ' + asOf, ['Side', 'Ledger', 'Amount'], lines));
}

/* ---------- cash flow ---------- */
function cf(out, p, exp) {
  const c = store.ctx();
  const r = cashFlow(c, p);
  const names = { operating: 'Operating — income, expenses, card dues & taxes', investing: 'Investing — investments, fixed assets, loans given', financing: 'Financing — loans taken & repaid, capital' };
  const lines = [];
  add(out, h('div.card', h('div.card-b', { style: { paddingTop: '12px' } },
    h('div.stmt-row.grp', h('span', 'Opening cash & bank'), h('span.amt', money(r.opening))),
    ...['operating', 'investing', 'financing'].map(k => {
      for (const x of r[k].rows) lines.push([k, x.group.name, xr(x.inflow), xr(x.outflow), xr(x.inflow - x.outflow)]);
      return [h('div.stmt-row.grp', h('span', names[k]), h('span', amt(r[k].total, { flow: true }))),
        ...r[k].rows.map(x => h('div.stmt-row.led', h('span', x.group.name, h('span.muted.small', `  in ${money(x.inflow)} · out ${money(x.outflow)}`)), h('span', amt(x.inflow - x.outflow, { flow: true }))))];
    }),
    h('div.stmt-row.tot', h('span', 'Net change'), h('span', amt(r.net, { flow: true }))),
    h('div.stmt-row.tot', h('span', 'Closing cash & bank'), h('span.amt', money(r.closing))),
    r.check !== 0 ? h('div.note.bad', 'Reconciliation difference ' + money(r.check)) : h('p.small.muted', 'Direct method over cash and bank ledgers; transfers between them are ignored.'))));
  add(exp, ...exportTable('Cash flow ' + p.label, ['Section', 'Group', 'Inflow', 'Outflow', 'Net'], lines));
}

/* ---------- net worth over time ---------- */
function networth(out, p, exp) {
  const c = store.ctx();
  const from = period.mode === 'fy' ? fyRange(fyOf(p.from)).from : p.from;
  const s = netWorthSeries(c, { from, to: asOfOf(p) });
  add(out, h('div.card', h('div.card-h', h('h3', 'Net worth'), h('span.sub', 'month end, assets − liabilities')), h('div.card-b', lineChart(s.map(x => ({ label: fmtMonth(x.month), value: x.value }))))),
    h('div.card', { style: { marginTop: '14px' } }, h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Month end'), h('th.r', 'Net worth'), h('th.r', 'Change'))),
      h('tbody', s.map((x, i) => h('tr', h('td', fmtDate(x.date)), h('td.r.amt', money(x.value)), h('td.r', i ? amt(x.value - s[i - 1].value, { flow: true }) : ''))))))));
  add(exp, ...exportTable('Net worth ' + p.label, ['Month end', 'Net worth'], s.map(x => [x.date, xr(x.value)])));
}

/* ---------- analysis ---------- */
const an_ui = { by: 'site' };
function an(out, p, exp, extra, redraw) {
  const c = store.ctx();
  add(clear(extra), select([['site', 'By site'], ['ledger', 'By ledger'], ['group', 'By group'], ['tag', 'By tax tag'], ['owner', 'By owner'], ['custom', 'By custom tag'], ['month', 'By month']].map(([v, l]) => ({ value: v, label: l })), an_ui.by, { class: 'inp sm', style: { width: 'auto' }, onchange: e => { an_ui.by = e.target.value; redraw(); } }));
  const rows = analysis(c, { ...p, by: an_ui.by });
  const label = k => an_ui.by === 'tag' ? (TAX_TAGS[k] || {}).label || k : an_ui.by === 'month' ? fmtMonth(k) : k;
  if (an_ui.by === 'month' && rows.length) add(out, h('div.card', { style: { marginBottom: '14px' } }, h('div.card-b', { style: { paddingTop: '12px' } }, barChart(rows.map(r => ({ label: fmtMonth(r.key).slice(0, 3), a: r.income, b: r.expense })), ['Income', 'Expenses']))));
  const tI = rows.reduce((t, r) => t + r.income, 0), tE = rows.reduce((t, r) => t + r.expense, 0);
  add(out, h('div.card', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', an_ui.by[0].toUpperCase() + an_ui.by.slice(1)), an_ui.by === 'site' ? h('th.r', 'Patients') : null, h('th.r', 'Income'), h('th.r', 'Expenses'), h('th.r', 'Net'))),
    h('tbody', rows.map(r => h('tr', h('td', label(r.key)), an_ui.by === 'site' ? h('td.r', r.visits || '') : null, h('td.r.amt', r.income ? money(r.income) : ''), h('td.r.amt', r.expense ? money(r.expense) : ''), h('td.r', amt(r.net, { flow: true }))))),
    h('tfoot', h('tr.tot', h('td', 'Total'), an_ui.by === 'site' ? h('td') : null, h('td.r.amt', money(tI)), h('td.r.amt', money(tE)), h('td.r', amt(tI - tE, { flow: true }))))))),
    an_ui.by === 'custom' || an_ui.by === 'owner' ? h('p.small.muted', 'An entry with several custom tags counts under each of them.') : null);
  add(exp, ...exportTable('Analysis by ' + an_ui.by + ' ' + p.label, [an_ui.by, 'Income', 'Expenses', 'Net'], rows.map(r => [label(r.key), xr(r.income), xr(r.expense), xr(r.net)])));
}

/* ---------- cash vs digital ---------- */
function cash(out, p, exp) {
  const c = store.ctx();
  const r = cashDigital(c, p);
  const pct = (r.cashPct * 100);
  const L50 = 50_00_000_00, L75 = 75_00_000_00;
  const limit = pct <= 5 ? L75 : L50;
  add(out, h('div.kpis',
    h('div.card.kpi', h('div.lbl', 'Professional receipts'), h('div.val', amt(r.total))),
    h('div.card.kpi', h('div.lbl', 'Cash'), h('div.val', amt(r.cash)), h('div.foot', pct.toFixed(2) + '% of receipts')),
    h('div.card.kpi', h('div.lbl', 'Digital (bank, UPI, card, TDS)'), h('div.val', amt(r.digital))),
    h('div.card.kpi', h('div.lbl', 'Applicable presumptive limit'), h('div.val', money(limit, { compact: true })), h('div.foot', pct <= 5 ? 'cash ≤ 5% → ₹75 lakh limit' : 'cash > 5% → ₹50 lakh limit'))),
    h('div.card', h('div.card-b', { style: { paddingTop: '12px' } },
      h('div.small', 'Receipts used against the limit: ' + money(r.total) + ' of ' + money(limit) + ' (' + Math.min(999, r.total / limit * 100).toFixed(1) + '%)'),
      h('div.meter', { style: { margin: '6px 0 10px' } }, h('i', { style: { width: Math.min(100, r.total / limit * 100) + '%', background: r.total > limit ? 'var(--out)' : r.total > 0.9 * limit ? 'var(--warn)' : 'var(--gold)' } })),
      h('p.small.muted', 'Every receipt, cash included, counts towards tax. The cash share decides which limit applies (Section 58, Income-tax Act 2025; non-account-payee cheques count as cash). Cash is worked out from debits to Cash-in-Hand ledgers in each receipt, or an explicit cash/digital mode on migrated entries.'))),
    h('div.card', { style: { marginTop: '14px' } }, h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Month'), h('th.r', 'Cash'), h('th.r', 'Digital'), h('th.r', 'Cash %'))),
      h('tbody', r.months.map(m => h('tr', h('td', fmtMonth(m.month)), h('td.r.amt', money(m.cash)), h('td.r.amt', money(m.digital)), h('td.r', ((m.cash / Math.max(1, m.cash + m.digital)) * 100).toFixed(1) + '%'))))))));
  add(exp, ...exportTable('Cash vs digital ' + p.label, ['Month', 'Cash', 'Digital'], r.months.map(m => [m.month, xr(m.cash), xr(m.digital)])));
}

/* ---------- family ---------- */
function fam(out, p, exp) {
  const ents = store.sortedEntities().filter(e => e.kind !== 'demo');
  const ctxs = ents.map(e => store.ctxOf(e.id));
  const asOf = asOfOf(p);
  const f = family(ctxs, { asOf, from: p.from });
  const cols = ['cash', 'bank', 'investments', 'otherAssets', 'loans', 'cards', 'otherLiab', 'netWorth', 'income', 'expense', 'surplus'];
  const lbl = { cash: 'Cash', bank: 'Bank', investments: 'Investments', otherAssets: 'Other assets', loans: 'Loans', cards: 'Credit cards', otherLiab: 'Other liabilities', netWorth: 'Net worth', income: 'Income', expense: 'Expenses', surplus: 'Surplus' };
  add(out, h('div.kpis', h('div.card.kpi', h('div.lbl', 'Family net worth'), h('div.val', amt(f.total.netWorth)), h('div.foot', 'as at ' + fmtDate(asOf))),
    h('div.card.kpi', h('div.lbl', 'Family income · ' + p.label), h('div.val', amt(f.total.income))),
    h('div.card.kpi', h('div.lbl', 'Family expenses'), h('div.val', amt(f.total.expense))),
    h('div.card.kpi', h('div.lbl', 'Family surplus'), h('div.val', amt(f.total.surplus, { flow: true })))),
    h('div.card', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th'), ...f.per.map(x => h('th.r', x.entity.name)), h('th.r', 'Family'))),
      h('tbody', cols.map(k => h('tr' + (k === 'netWorth' || k === 'surplus' ? '.tot' : ''), h('td', lbl[k]), ...f.per.map(x => h('td.r.amt', money(x[k]))), h('td.r.amt', money(f.total[k])))))))),
    f.total.interEntityDifference ? h('div.note.warn', { style: { marginTop: '12px' } }, 'Inter-entity current accounts do not cancel out (difference ' + money(f.total.interEntityDifference) + '). Check both sides of transfers between entities.')
      : h('p.small.muted', 'Money held for one another (inter-entity current accounts) cancels out in the family totals. The demo entity is excluded.'));
  add(exp, ...exportTable('Family ' + asOf, ['Item', ...f.per.map(x => x.entity.name), 'Family'], cols.map(k => [lbl[k], ...f.per.map(x => xr(x[k])), xr(f.total[k])])));
}
