/* Reports. Plain wording by default; the CA pages show formal names. Totals drill down to entries. */
import { h, clear, money, amt, drcr, add } from '../ui/dom.js';
import { exportTable, xr, select, field } from '../ui/widgets.js';
import { periodControl, currentPeriod, priorPeriod, period } from '../ui/pickers.js';
import * as store from '../app/store.js';
import { trialBalance, profitLoss, balanceSheet, cashFlow, netWorthSeries, analysis, cashDigital, family, ledgerStatement, dayBook } from '../core/books.js';
import { TAX_TAGS, ROOTS, sectionFor } from '../core/masters.js';
import { capitalGains, valueAsset, tradingSummary } from '../core/invest.js';
import { lineChart, barChart } from '../ui/charts.js';
import { fmtDate, fmtMonth, today, fyOf, fyRange } from '../lib/dates.js';
import { t, isCA, groupName, ledgerName, kindName } from '../ui/terms.js';
import { VTYPES } from '../core/vouchers.js';

const TITLE = { tb: 'Trial balance', pl: 'Income & spending', bs: 'What I own & owe', cf: 'Money in & out', networth: 'Net worth over time', analysis: 'Breakdown', cash: 'Cash vs digital receipts', family: 'Family' };
const CA_TITLE = { pl: 'Profit & loss account', bs: 'Balance sheet', cf: 'Cash flow statement' };
const goLedger = id => { location.hash = (isCA() ? '#/ca-ledger/' : '#/ledger/') + id; };

export function renderReport(root, name) {
  const out = h('div');
  const exp = h('span.btnrow');
  const extra = h('span.btnrow');
  add(root, h('div.toolbar', periodControl(draw, { allowCompare: name === 'pl' }), extra, h('span.spacer'), exp), out);
  const R = { tb, pl, bs, cf, networth, analysis: an, cash, family: fam }[name];
  function draw() {
    const p = currentPeriod();
    clear(out); clear(exp);
    add(out, h('div.print-head', h('h2', (isCA() && CA_TITLE[name]) || TITLE[name]), h('div', (name === 'family' ? 'Family' : store.activeEntity().name) + ' · ' + p.label)));
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
    rows.push(h('tr.grp', h('td', ROOTS[g.group.root].name + ' › ' + groupName(g.group)), h('td.r.hide-sm'), h('td.r.hide-sm'), h('td.r.amt', g.closing > 0 ? money(g.closing) : ''), h('td.r.amt', g.closing < 0 ? money(-g.closing) : '')));
    for (const r of g.rows) rows.push(h('tr.click', { onclick: () => goLedger(r.ledger.id) }, h('td.ind', ledgerName(r.ledger)), h('td.r.amt.hide-sm', drcr(r.opening)), h('td.r.amt.hide-sm', money(r.dr - r.cr, { sign: true })), h('td.r.amt', r.closing > 0 ? money(r.closing) : ''), h('td.r.amt', r.closing < 0 ? money(-r.closing) : '')));
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
    sections.length ? sections.map(s => [row(groupName(s.group), s.total, 'grp', null, prevGroup(s.group.id, key)), ...s.rows.map(x => row(ledgerName(x.ledger), x.amount, 'led', () => goLedger(x.ledger.id), prevOf(x.ledger.id)))]) : h('div.muted.small', 'Nothing in this period.'),
    row('Total ' + title.toLowerCase(), total, 'tot', null, prevTotal)));
  add(out, h('div.stmt', side('Income', r.income, r.totalIncome, 'income', cmp && cmp.totalIncome), side(t('Spending', 'Expenses'), r.expense, r.totalExpense, 'expense', cmp && cmp.totalExpense)));
  add(out, h('div.card', { style: { marginTop: '14px' } }, h('div.card-b', { style: { paddingTop: '12px' } },
    row(r.surplus >= 0 ? t('Saved in this period (income − spending)', 'Surplus for the period (transferred to capital)') : t('Spent more than earned', 'Deficit for the period'), r.surplus, 'tot', null, cmp && cmp.surplus))));
  const pr = r.prof;
  add(out, h('div.card', { style: { marginTop: '14px' } }, h('div.card-h', h('h3', t('Practice income (for tax)', 'Professional income summary')), h('span.sub', t('what your CA uses for the income-tax return', 'basis for ITR-3 business & profession schedule'))), h('div.card-b',
    row(t('Total practice income', 'Gross professional receipts'), pr.receipts, '', null, cmp && cmp.prof.receipts),
    row(t('Practice expenses (allowed in tax)', 'Professional expenses (deductible)'), pr.expenses, '', null, cmp && cmp.prof.expenses),
    row(t('Practice profit — actual', 'Net professional income — actual basis'), pr.net, 'tot', null, cmp && cmp.prof.net),
    row(t('Half of practice income (the simple “presumptive” tax option)', 'Deemed profit at 50% (presumptive, Sec 58 / 44ADA) — reference'), Math.round(pr.receipts / 2), '', null, cmp && Math.round(cmp.prof.receipts / 2)),
    h('p.small.muted', t('Under the simple tax option, half of practice income is treated as profit. Showing less than half needs proper books and a tax audit. Your full tax comparison comes in the tax phase.', 'Declaring less than 50% under the presumptive scheme requires books and a tax audit when income exceeds the exemption limit. Regime comparison and eligibility checks arrive in Phase 3.')))));
  const lines = [];
  for (const [k, secs] of [['Income', r.income], ['Expense', r.expense]]) for (const s of secs) for (const x of s.rows) lines.push([k, groupName(s.group), ledgerName(x.ledger), TAX_TAGS[x.ledger.taxTag] ? TAX_TAGS[x.ledger.taxTag].label : '', xr(x.amount), cmp ? xr(prevOf(x.ledger.id) || 0) : '']);
  add(exp, ...exportTable(t('Income and spending ', 'Profit and loss ') + p.label, ['Side', t('Section', 'Group'), t('Category', 'Ledger'), t('Tax treatment', 'Tax tag'), p.label, cmp ? cmpP.label : ''], lines));
}

/* ---------- balance sheet ---------- */
function bs(out, p, exp) {
  const c = store.ctx();
  const asOf = asOfOf(p);
  const b = balanceSheet(c, { asOf, periodFrom: p.from });
  const row = (label, val, cls, onclick) => h('div.stmt-row' + (cls ? '.' + cls : '') + (onclick ? '.click' : ''), { onclick }, h('span', label), h('span.amt', money(val)));
  const block = sections => sections.map(s => [row(groupName(s.group), s.total, 'grp'), ...s.rows.map(x => row(ledgerName(x.ledger), x.amount, 'led', () => goLedger(x.ledger.id)))]);
  const cap = b.capital;
  add(out, h('p.muted', { style: { marginTop: 0 } }, 'As at ' + fmtDate(asOf)),
    h('div.stmt',
      h('div.card', h('div.card-h', h('h3', t('What I owe & my net worth', 'Capital & liabilities'))), h('div.card-b',
        row(t('My net worth', 'Capital account'), cap.total, 'grp'),
        row(t('When I started (plus family gifts)', 'Opening capital & capital movements'), cap.ledgers, 'led', c.capital ? () => goLedger(c.capital.id) : null),
        row(t('Saved in earlier years', 'Surplus of earlier periods'), cap.accumulated, 'led'),
        row(t('Saved this year', 'Surplus for this period'), cap.current, 'led', () => { location.hash = isCA() ? '#/ca-pl' : '#/pl'; }),
        block(b.liabilities), row('Total', b.totalLiabilities, 'tot'))),
      h('div.card', h('div.card-h', h('h3', t('What I own', 'Assets'))), h('div.card-b', block(b.assets), row('Total', b.totalAssets, 'tot')))),
    h('div', { class: 'note ' + (b.diff === 0 ? 'ok' : 'bad'), style: { marginTop: '12px' } }, b.diff === 0 ? t('✓ Both sides match.', '✓ Balance sheet tallies.') : '⚠ Difference of ' + money(b.diff) + '.'));
  const lines = [[t('Net worth', 'Capital'), t('My net worth', 'Capital account'), xr(cap.total)], ...b.liabilities.flatMap(s => s.rows.map(x => [t('I owe', 'Liability'), groupName(s.group) + ' › ' + ledgerName(x.ledger), xr(x.amount)])), ...b.assets.flatMap(s => s.rows.map(x => [t('I own', 'Asset'), groupName(s.group) + ' › ' + ledgerName(x.ledger), xr(x.amount)]))];
  add(exp, ...exportTable(t('What I own and owe ', 'Balance sheet ') + asOf, ['Side', t('Account', 'Ledger'), 'Amount'], lines));
}

/* ---------- cash flow ---------- */
function cf(out, p, exp) {
  const c = store.ctx();
  const r = cashFlow(c, p);
  const names = isCA() ? { operating: 'Operating — income, expenses, card dues & taxes', investing: 'Investing — investments, fixed assets, loans given', financing: 'Financing — loans taken & repaid, capital' }
    : { operating: 'Day to day — income, spending, card bills, tax', investing: 'Investments, property and money lent', financing: 'Loans taken / repaid and family gifts' };
  const lines = [];
  add(out, h('div.card', h('div.card-b', { style: { paddingTop: '12px' } },
    h('div.stmt-row.grp', h('span', t('Cash & bank at start', 'Opening cash & bank')), h('span.amt', money(r.opening))),
    ...['operating', 'investing', 'financing'].map(k => {
      for (const x of r[k].rows) lines.push([k, x.group.name, xr(x.inflow), xr(x.outflow), xr(x.inflow - x.outflow)]);
      return [h('div.stmt-row.grp', h('span', names[k]), h('span', amt(r[k].total, { flow: true }))),
        ...r[k].rows.map(x => h('div.stmt-row.led', h('span', groupName(x.group), h('span.muted.small', `  in ${money(x.inflow)} · out ${money(x.outflow)}`)), h('span', amt(x.inflow - x.outflow, { flow: true }))))];
    }),
    h('div.stmt-row.tot', h('span', t('Change', 'Net change')), h('span', amt(r.net, { flow: true }))),
    h('div.stmt-row.tot', h('span', t('Cash & bank now', 'Closing cash & bank')), h('span.amt', money(r.closing))),
    r.check !== 0 ? h('div.note.bad', 'Reconciliation difference ' + money(r.check)) : h('p.small.muted', t('Only cash and bank money. Moving money between your own accounts is not counted.', 'Direct method over cash and bank ledgers; transfers between them are ignored.')))));
  add(exp, ...exportTable('Cash flow ' + p.label, ['Section', 'Group', 'Inflow', 'Outflow', 'Net'], lines));
}

/* ---------- net worth over time ---------- */
function networth(out, p, exp) {
  const c = store.ctx();
  const from = period.mode === 'fy' ? fyRange(fyOf(p.from)).from : p.from;
  const s = netWorthSeries(c, { from, to: asOfOf(p) });
  add(out, h('div.card', h('div.card-h', h('h3', 'Net worth'), h('span.sub', 'end of each month: what you own − what you owe')), h('div.card-b', lineChart(s.map(x => ({ label: fmtMonth(x.month), value: x.value }))))),
    h('div.card', { style: { marginTop: '14px' } }, h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Month end'), h('th.r', 'Net worth'), h('th.r', 'Change'))),
      h('tbody', s.map((x, i) => h('tr', h('td', fmtDate(x.date)), h('td.r.amt', money(x.value)), h('td.r', i ? amt(x.value - s[i - 1].value, { flow: true }) : ''))))))));
  add(exp, ...exportTable('Net worth ' + p.label, ['Month end', 'Net worth'], s.map(x => [x.date, xr(x.value)])));
}

/* ---------- analysis ---------- */
const an_ui = { by: 'site' };
function an(out, p, exp, extra, redraw) {
  const c = store.ctx();
  add(clear(extra), select([['site', 'By site'], ['ledger', 'By category'], ['group', 'By section'], ['tag', 'By tax treatment'], ['owner', 'By owner'], ['custom', 'By label'], ['month', 'By month']].map(([v, l]) => ({ value: v, label: l })), an_ui.by, { class: 'inp sm', style: { width: 'auto' }, onchange: e => { an_ui.by = e.target.value; redraw(); } }));
  const rows = analysis(c, { ...p, by: an_ui.by });
  const label = k => an_ui.by === 'tag' ? (TAX_TAGS[k] || {}).label || k : an_ui.by === 'month' ? fmtMonth(k) : k;
  if (an_ui.by === 'month' && rows.length) add(out, h('div.card', { style: { marginBottom: '14px' } }, h('div.card-b', { style: { paddingTop: '12px' } }, barChart(rows.map(r => ({ label: fmtMonth(r.key).slice(0, 3), a: r.income, b: r.expense })), ['Income', 'Expenses']))));
  const tI = rows.reduce((t, r) => t + r.income, 0), tE = rows.reduce((t, r) => t + r.expense, 0);
  add(out, h('div.card', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', { site: 'Site', ledger: 'Category', group: 'Section', tag: 'Tax treatment', owner: 'Owner', custom: 'Label', month: 'Month' }[an_ui.by]), an_ui.by === 'site' ? h('th.r', 'Patients') : null, h('th.r', 'Income'), h('th.r', 'Spending'), h('th.r', 'Net'))),
    h('tbody', rows.map(r => h('tr', h('td', label(r.key)), an_ui.by === 'site' ? h('td.r', r.visits || '') : null, h('td.r.amt', r.income ? money(r.income) : ''), h('td.r.amt', r.expense ? money(r.expense) : ''), h('td.r', amt(r.net, { flow: true }))))),
    h('tfoot', h('tr.tot', h('td', 'Total'), an_ui.by === 'site' ? h('td') : null, h('td.r.amt', money(tI)), h('td.r.amt', money(tE)), h('td.r', amt(tI - tE, { flow: true }))))))),
    an_ui.by === 'custom' || an_ui.by === 'owner' ? h('p.small.muted', 'An entry with several labels counts under each of them.') : null);
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
      h('p.small.muted', 'All money received counts for tax, cash included. If cash is 5% or less of your practice income, the simple tax option allows up to ₹75 lakh; otherwise ₹50 lakh (Section 58 of the new Income-tax Act). Cheques not marked “account payee” count as cash.'))),
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
  const lbl = { cash: 'Cash', bank: 'Bank', investments: 'Investments', otherAssets: 'Other things I own', loans: 'Loans', cards: 'Credit cards', otherLiab: 'Other dues', netWorth: 'Net worth', income: 'Income', expense: 'Spending', surplus: 'Saved' };
  add(out, h('div.kpis', h('div.card.kpi', h('div.lbl', 'Family net worth'), h('div.val', amt(f.total.netWorth)), h('div.foot', 'as at ' + fmtDate(asOf))),
    h('div.card.kpi', h('div.lbl', 'Family income · ' + p.label), h('div.val', amt(f.total.income))),
    h('div.card.kpi', h('div.lbl', 'Family spending'), h('div.val', amt(f.total.expense))),
    h('div.card.kpi', h('div.lbl', 'Family savings'), h('div.val', amt(f.total.surplus, { flow: true })))),
    h('div.card', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th'), ...f.per.map(x => h('th.r', x.entity.name)), h('th.r', 'Family'))),
      h('tbody', cols.map(k => h('tr' + (k === 'netWorth' || k === 'surplus' ? '.tot' : ''), h('td', lbl[k]), ...f.per.map(x => h('td.r.amt', money(x[k]))), h('td.r.amt', money(f.total[k])))))))),
    f.total.interEntityDifference ? h('div.note.warn', { style: { marginTop: '12px' } }, 'Money “to be returned” between family members does not match on both sides (difference ' + money(f.total.interEntityDifference) + '). Check Money with family.')
      : h('p.small.muted', 'Money given between family members is counted once in the family totals. The demo is not included.'));
  add(exp, ...exportTable('Family ' + asOf, ['Item', ...f.per.map(x => x.entity.name), 'Family'], cols.map(k => [lbl[k], ...f.per.map(x => xr(x[k])), xr(f.total[k])])));
}

/* ---------- one Excel file for the CA ---------- */
export function renderCaPack(root) {
  const e = store.activeEntity();
  const ents = store.sortedEntities().filter(x => x.kind !== 'demo' || x.id === e.id);
  const sel = select(ents.map(x => ({ value: x.id, label: x.name })), e.id, { class: 'inp', style: { width: 'auto' } });
  const status = h('div.small.muted');
  add(root, h('div.card', h('div.card-b', { style: { paddingTop: '14px' } },
    h('p', { style: { marginTop: 0 } }, 'One Excel file with everything your accountant or CA needs for the year, in their language:'),
    h('ul.small', h('li', 'Trial balance, Profit & loss account, Balance sheet'), h('li', 'Day book — every entry with debit / credit'), h('li', 'Ledger-wise entries with running balances'),
      h('li', 'TDS deducted by hospitals, cash vs digital receipts by month'), h('li', 'Capital gains (FIFO, with dates and ISIN), holdings, F&O / intraday summary'), h('li', 'Chart of accounts with tax tags and section numbers'), h('li', 'Family gifts and money to be returned')),
    h('div.btnrow', field('Person', sel), h('div', { style: { alignSelf: 'end' } }, periodControl(() => {})), h('button.btn.primary', { style: { alignSelf: 'end' }, onclick: async () => {
      status.textContent = 'Preparing…';
      try { await buildPack(sel.value, currentPeriod()); status.textContent = 'Downloaded.'; } catch (err) { status.textContent = 'Could not create the file: ' + err.message; }
    } }, '⇩ Download CA pack (Excel)')), status)));
}
async function buildPack(entityId, p) {
  const { loadXLSX } = await import('../import/libs.js');
  const XLSX = await loadXLSX();
  const c = store.ctxOf(entityId);
  const ent = c.entity;
  const asOf = p.to;
  const wb = XLSX.utils.book_new();
  const sheet = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  const LN = l => (l.system === 'capital' ? 'Capital Account' : l.system === 'suspense' ? 'Suspense' : l.name);
  const GN = g => (g ? ({ bank: 'Bank Accounts', cash: 'Cash-in-Hand', advances: 'Loans & Advances (Asset)', taxassets: 'Taxes Paid & TDS', fixed: 'Fixed Assets', loans: 'Loans (Liability)', cards: 'Credit Cards', curliab: 'Current Liabilities', capital: 'Capital Account', profinc: 'Professional Receipts', othinc: 'Other Income', profexp: 'Professional Expenses', finexp: 'Finance Costs', personal: 'Personal & Household' }[g.key] || g.name) : '');
  const head = title => [[ent.name + ' — ' + title], ['Period: ' + p.from + ' to ' + p.to], []];

  const tbr = trialBalance(c, { from: p.from, to: asOf });
  sheet('Trial balance', [...head('Trial balance as at ' + asOf), ['Group', 'Ledger', 'Opening', 'Debit (period)', 'Credit (period)', 'Closing Dr', 'Closing Cr'],
    ...tbr.groups.flatMap(g => g.rows.map(r => [GN(g.group), LN(r.ledger), xr(r.opening), xr(r.dr), xr(r.cr), r.closing > 0 ? xr(r.closing) : '', r.closing < 0 ? xr(-r.closing) : ''])),
    [], ['', 'Total', '', '', '', xr(tbr.totDr), xr(tbr.totCr)]]);

  const pl = profitLoss(c, p);
  const fy = fyOf(p.from);
  sheet('Profit & loss', [...head('Profit & loss account'), ['Side', 'Group', 'Ledger', 'Tax tag', 'Section', 'Amount'],
    ...pl.income.flatMap(s => s.rows.map(x => ['Income', GN(s.group), LN(x.ledger), x.ledger.taxTag, sectionFor(x.ledger.taxTag, fy), xr(x.amount)])),
    ...pl.expense.flatMap(s => s.rows.map(x => ['Expense', GN(s.group), LN(x.ledger), x.ledger.taxTag, sectionFor(x.ledger.taxTag, fy), xr(x.amount)])),
    [], ['', '', 'Total income', '', '', xr(pl.totalIncome)], ['', '', 'Total expenses', '', '', xr(pl.totalExpense)], ['', '', 'Surplus / (deficit)', '', '', xr(pl.surplus)],
    [], ['', '', 'Gross professional receipts', '', sectionFor('prof_receipts', fy), xr(pl.prof.receipts)], ['', '', 'Professional expenses', '', '', xr(pl.prof.expenses)], ['', '', 'Net professional income (actual)', '', '', xr(pl.prof.net)], ['', '', 'Deemed profit @50% (presumptive)', '', '', xr(Math.round(pl.prof.receipts / 2))]]);

  const b = balanceSheet(c, { asOf, periodFrom: p.from });
  sheet('Balance sheet', [...head('Balance sheet as at ' + asOf), ['Side', 'Group', 'Ledger', 'Amount'],
    ['Capital', 'Capital Account', 'Opening capital & movements', xr(b.capital.ledgers)], ['Capital', 'Capital Account', 'Accumulated surplus', xr(b.capital.accumulated)], ['Capital', 'Capital Account', 'Surplus for the period', xr(b.capital.current)],
    ...b.liabilities.flatMap(s => s.rows.map(x => ['Liability', GN(s.group), LN(x.ledger), xr(x.amount)])),
    ...b.assets.flatMap(s => s.rows.map(x => ['Asset', GN(s.group), LN(x.ledger), xr(x.amount)])),
    [], ['', '', 'Total capital & liabilities', xr(b.totalLiabilities)], ['', '', 'Total assets', xr(b.totalAssets)]]);

  const days = dayBook(c, p).slice().reverse();
  const M = v => v.meta || {};
  sheet('Day book', [...head('Day book'), ['Date', 'Voucher no.', 'Type', 'Ledger', 'Debit', 'Credit', 'Narration', 'Party', 'Mode', 'Ref no.', 'Bill no.', 'GST', 'GSTIN'],
    ...days.flatMap(v => v.lines.map((l, i) => [i ? '' : v.date, i ? '' : v.no, i ? '' : VTYPES[v.type].name, LN(c.lById.get(l.ledgerId) || { name: '?' }), l.dr ? xr(l.dr) : '', l.cr ? xr(l.cr) : '', i ? '' : v.narration,
      i ? '' : M(v).party || '', i ? '' : M(v).payMode || '', i ? '' : M(v).ref || '', i ? '' : M(v).billNo || '', i || !M(v).gst ? '' : xr(M(v).gst), i ? '' : M(v).gstin || '']))]);

  const ledRows = [];
  for (const l of c.ledgers) {
    const st = ledgerStatement(c, l.id, p);
    if (!st.rows.length && !st.opening) continue;
    ledRows.push([LN(l), GN(c.groupOf(l)), p.from, '', 'Opening balance', '', '', xr(st.opening)]);
    for (const r of st.rows) ledRows.push([LN(l), GN(c.groupOf(l)), r.date, r.voucher.no, r.particulars, r.dr ? xr(r.dr) : '', r.cr ? xr(r.cr) : '', xr(r.balance)]);
    ledRows.push([LN(l), GN(c.groupOf(l)), p.to, '', 'Closing balance', xr(st.dr), xr(st.cr), xr(st.closing)], []);
  }
  sheet('Ledgers', [...head('Ledger-wise entries (balance: + Dr / − Cr)'), ['Ledger', 'Group', 'Date', 'Voucher no.', 'Particulars', 'Debit', 'Credit', 'Balance'], ...ledRows]);

  const tdsL = c.ledgers.filter(l => l.taxTag === 'tds_receivable');
  const tdsRows = [];
  for (const v of dayBook(c, p).slice().reverse()) for (const ln of v.lines) if (tdsL.some(l => l.id === ln.ledgerId) && ln.dr) {
    const inc = v.lines.find(x => x.cr && (c.lById.get(x.ledgerId) || {}).taxTag === 'prof_receipts');
    tdsRows.push([v.date, v.no, inc ? LN(c.lById.get(inc.ledgerId)) : '', inc ? xr(inc.cr) : '', xr(ln.dr), v.narration]);
  }
  sheet('TDS', [...head('TDS deducted (match with 26AS / AIS)'), ['Date', 'Voucher no.', 'Income ledger', 'Gross', 'TDS', 'Narration'], ...tdsRows]);

  const cd = cashDigital(c, p);
  sheet('Cash vs digital', [...head('Professional receipts: cash vs digital'), ['Month', 'Cash', 'Digital', 'Cash %'], ...cd.months.map(m => [m.month, xr(m.cash), xr(m.digital), Math.round(m.cash / Math.max(1, m.cash + m.digital) * 10000) / 100]),
    [], ['Total', xr(cd.cash), xr(cd.digital), Math.round(cd.cashPct * 10000) / 100]]);

  const famRows = dayBook(c, p).filter(v => v.src === 'family').reverse().map(v => {
    const f = v.meta.family; const other = store.entityById(f.fromEntityId === entityId ? f.toEntityId : f.fromEntityId);
    return [v.date, f.fromEntityId === entityId ? 'Given to' : 'Received from', other ? other.name : '', f.kind === 'gift' ? 'Gift' : 'To be returned', xr(v.lines[0].dr), v.narration];
  });
  sheet('Family transfers', [...head('Money with family members (gifts may attract clubbing of income)'), ['Date', 'Direction', 'Person', 'Kind', 'Amount', 'Narration'], ...famRows]);

  const assets = store.assetsOf(entityId);
  const cg = capitalGains(assets, c.vouchers, fy);
  sheet('Capital gains', [...head('Capital gains (FIFO) – tax year ' + fy), ['Investment', 'ISIN', 'Class', 'Term', 'Bought on', 'Sold on', 'Quantity', 'Cost', 'Cost for tax (FMV 2018 rule)', 'Sale value', 'Gain'],
    ...cg.rows.map(r => [r.asset.name, r.asset.isin || '', r.cls, r.term, r.buyDate, r.sellDate, r.qty, xr(r.cost), xr(r.taxCost), xr(r.proceeds), xr(r.taxGain)]),
    [], ['Equity STCG', xr(cg.buckets.eqST)], ['Equity LTCG', xr(cg.buckets.eqLT)], ['Other STCG (slab)', xr(cg.buckets.othST)], ['Other LTCG', xr(cg.buckets.othLT)], ['VDA (crypto) income', xr(cg.buckets.vda)], ['VDA losses (ignored)', xr(cg.buckets.vdaLoss)], ['LTCG exemption used', xr(cg.exempt)], ['Estimated tax at special rates', xr(cg.taxSpecial)]]);
  sheet('Holdings', [...head('Holdings as at ' + asOf + ' (FIFO, at cost)'), ['Investment', 'Type', 'ISIN / symbol', 'Quantity', 'Cost', 'Price', 'Value'],
    ...assets.map(a => valueAsset(a, c.vouchers, asOf)).filter(x => x.cost || x.qty).map(x => [x.asset.name, x.type.name, x.asset.isin || x.asset.symbol || '', x.qty == null ? '' : x.qty, xr(x.cost), x.asset.price ? xr(x.asset.price) : '', xr(x.value)])]);
  const ts = tradingSummary(c.vouchers, fy);
  if (ts.segments.length) sheet('F&O intraday', [...head('Trading – tax year ' + fy), ['Segment', 'Entries', 'Profit', 'Loss', 'Charges', 'Net', 'Turnover'], ...ts.segments.map(x => [x.segment, x.count, xr(x.profit), xr(x.loss), xr(x.charges), xr(x.net), xr(x.turnover)]), [], ['F&O turnover', xr(ts.turnover)]]);
  sheet('Chart of accounts', [[ent.name + ' — chart of accounts'], [], ['Root', 'Group', 'Ledger', 'Tax tag', 'Section (' + fy + ')', 'Opening balance (+Dr / −Cr)'],
    ...c.ledgers.filter(l => !l.archived).map(l => [ROOTS[c.rootOf(l)].name, GN(c.groupOf(l)), LN(l), (TAX_TAGS[l.taxTag] || {}).label || '', sectionFor(l.taxTag, fy), xr(l.system === 'capital' ? 0 : l.opening || 0)])]);

  XLSX.writeFile(wb, `CA pack ${ent.name} ${p.from} to ${p.to}.xlsx`);
}
