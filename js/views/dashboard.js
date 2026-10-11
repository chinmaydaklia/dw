/* Dashboard: balances, this year's income/expense, professional receipts & cash share, quick entry, charts. */
import { h, money, amt, add } from '../ui/dom.js';
import * as store from '../app/store.js';
import { S } from '../app/store.js';
import { headline, analysis, netWorthSeries, cashDigital, balances, dayBook } from '../core/books.js';
import { dueDates } from '../core/recurring.js';
import { quickBar, openEntry, openVoucher } from '../views/entry.js';
import { barChart, lineChart } from '../ui/charts.js';
import { fyRange, fyOf, today, fmtDate, fmtMonth, monthsBetween } from '../lib/dates.js';
import { currentPeriod } from '../ui/pickers.js';

export function renderDashboard(root) {
  const c = store.ctx();
  const t = today();
  const p = currentPeriod();
  const to = p.to < t ? p.to : t;
  const hd = headline(c, { asOf: to, from: p.from });
  const qb = quickBar();
  add(root, h('div.card', { style: { marginBottom: '14px' } }, h('div.card-b', { style: { paddingTop: '12px' } }, qb)));

  add(root, h('div.kpis',
    kpi('Net worth', amt(hd.netWorth), `Own ${money(hd.assets, { compact: true })} · Owe ${money(hd.liabilities, { compact: true })}`, () => go('bs')),
    kpi('Cash & bank', amt(hd.cash + hd.bank + hd.wallets), `Cash ${money(hd.cash, { compact: true })} · Bank ${money(hd.bank, { compact: true })}` + (hd.wallets ? ` · Wallets ${money(hd.wallets, { compact: true })}` : ''), () => go('ledgers')),
    kpi('Income · ' + p.label, amt(hd.income, { cls: 'in' }), `Spent ${money(hd.expense, { compact: true })} · Saved ${money(hd.surplus, { compact: true, sign: true })}`, () => go('pl')),
    kpi('Practice income', amt(hd.prof.receipts), `After practice expenses ${money(hd.prof.net, { compact: true })}`, () => go('cash'))));

  /* alerts */
  const alerts = [];
  const due = S.recurring.filter(r => r.entityId === c.entity.id).map(r => ({ r, n: dueDates(r, t).length })).filter(x => x.n);
  if (due.length) alerts.push(h('div.note.warn', '↻ ' + due.reduce((s2, x) => s2 + x.n, 0) + ' repeating entr' + (due.length === 1 && due[0].n === 1 ? 'y is' : 'ies are') + ' due (' + due.map(x => x.r.name).join(', ') + '). ', h('a', { href: '#/recurring' }, 'Check & add')));
  const susp = c.ledgers.find(l => l.system === 'suspense');
  if (susp) { const b = balances(c).get(susp.id).closing; if (b) alerts.push(h('div.note.warn', money(Math.abs(b)) + ' of imported entries still need a category. ', h('a', { href: '#/ledger/' + susp.id }, 'Sort them now'))); }
  if (!S.settings.lastBackupAt && c.vouchers.length && c.entity.kind !== 'demo') alerts.push(h('div.note', 'Tip: download a backup (Settings & backup) and keep it somewhere safe.'));
  if (alerts.length) add(root, h('div.cards', { style: { marginBottom: '14px' } }, alerts));

  /* charts */
  const months = monthsBetween(p.from, to);
  const byM = new Map(analysis(c, { from: p.from, to, by: 'month' }).map(r => [r.key, r]));
  const data = months.map(k => ({ label: fmtMonth(k).slice(0, 3), a: (byM.get(k) || {}).income || 0, b: (byM.get(k) || {}).expense || 0 }));
  const nw = netWorthSeries(c, { from: p.from, to }).map(x => ({ label: fmtMonth(x.month), value: x.value }));
  add(root, h('div.two',
    h('div.card', h('div.card-h', h('h3', 'Income and spending by month'), h('span.sub', p.label)), h('div.card-b', barChart(data, ['Income', 'Spending']))),
    h('div.card', h('div.card-h', h('h3', 'Net worth'), h('span.sub', 'month end')), h('div.card-b', lineChart(nw)))));

  /* sites + cash share + recent */
  const sites = analysis(c, { from: p.from, to, by: 'site' }).filter(r => r.income);
  const cd = cashDigital(c, { from: p.from, to });
  const recent = dayBook(c, { to: t }).slice(0, 8);
  add(root, h('div.two', { style: { marginTop: '14px' } },
    h('div.card', h('div.card-h', h('h3', 'Recent entries'), h('span.spacer'), h('a.small', { href: '#/daybook' }, 'All entries →')),
      h('div.card-b', recent.length ? h('table.tbl', h('tbody', recent.map(v => h('tr.click', { onclick: () => openVoucher(v.id) }, h('td.nowrap', fmtDate(v.date)), h('td', v.narration || ((c.lById.get((v.lines.find(l => !c.isMoney(l.ledgerId)) || v.lines[0]).ledgerId) || {}).name || '—'), h('div.narr', v.no)), h('td.r', amt(flow(c, v), { flow: true }))))))
        : h('div.empty', 'Nothing yet. Type in the quick entry box above, or ', h('a', { href: '#', onclick: e => { e.preventDefault(); openEntry('income'); } }, 'add money received'), '.'))),
    h('div.cards',
      h('div.card', h('div.card-h', h('h3', 'Income by site'), h('span.sub', p.label)), h('div.card-b', sites.length ? h('table.tbl', h('tbody', sites.map(r => h('tr', h('td', r.key), h('td.r.muted.small', r.visits ? r.visits + ' patients' : ''), h('td.r', amt(r.income)))))) : h('div.muted.small', 'No income yet.'))),
      h('div.card', h('div.card-h', h('h3', 'Cash share of practice income')), h('div.card-b',
        h('div.meter', { role: 'meter', 'aria-valuenow': Math.round(cd.cashPct * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: Math.min(100, cd.cashPct * 100).toFixed(1) + '%' } })),
        h('div.small', { style: { marginTop: '6px' } }, (cd.cashPct * 100).toFixed(1) + '% cash · ' + money(cd.cash) + ' of ' + money(cd.total)),
        h('div.small.muted', 'Keep cash at 5% or less to use the higher ₹75 lakh limit of the simple tax option. Live tax estimate comes in the tax phase.'))))));
}
function kpi(label, val, foot, onclick) { return h('div.card.kpi', { onclick, style: { cursor: 'pointer' }, title: 'Open report' }, h('div.lbl', label), h('div.val', val), h('div.foot', foot)); }
function go(r) { location.hash = '#/' + r; }
/* net effect of a voucher on cash/bank (for a +/− display); falls back to its total */
export function flow(c, v) {
  let m = 0;
  for (const l of v.lines) if (c.isMoney(l.ledgerId)) m += (l.dr || 0) - (l.cr || 0);
  if (m) return m;
  const tot = v.lines.reduce((t, l) => t + (l.dr || 0), 0);
  const inc = v.lines.some(l => { const led = c.lById.get(l.ledgerId); return led && c.rootOf(led) === 'income' && l.cr; });
  const exp = v.lines.some(l => { const led = c.lById.get(l.ledgerId); return led && c.rootOf(led) === 'expense' && l.dr; });
  return inc ? tot : exp ? -tot : 0;
}
