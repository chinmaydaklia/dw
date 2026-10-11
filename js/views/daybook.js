/* All entries (plain) / Day book with Dr / Cr (CA view). */
import { h, clear, money, amt, add } from '../ui/dom.js';
import { exportTable, xr, select } from '../ui/widgets.js';
import { periodControl, currentPeriod } from '../ui/pickers.js';
import * as store from '../app/store.js';
import { dayBook, particulars } from '../core/books.js';
import { VTYPES } from '../core/vouchers.js';
import { openVoucher, openQuickAdd } from './entry.js';
import { flow } from './dashboard.js';
import { fmtDate } from '../lib/dates.js';
import { t, isCA, kindName, ledgerName } from '../ui/terms.js';

const ui = { type: '', q: '', site: '' };
export function renderDaybook(root) {
  const c = store.ctx();
  const out = h('div');
  const q = h('input.inp.sm', { placeholder: 'Search note, category or amount', value: ui.q, style: { width: '240px' }, oninput: e => { ui.q = e.target.value; draw(); } });
  const typeSel = select([{ value: '', label: 'All types' }, ...Object.keys(VTYPES).map(k => ({ value: k, label: kindName(k) }))], ui.type, { class: 'inp sm', style: { width: 'auto' }, onchange: e => { ui.type = e.target.value; draw(); } });
  const siteSel = select([{ value: '', label: 'All sites' }, ...(c.entity.sites || []).map(s => ({ value: s.id, label: s.name }))], ui.site, { class: 'inp sm', style: { width: 'auto' }, onchange: e => { ui.site = e.target.value; draw(); } });
  const exp = h('span.btnrow');
  add(root, h('div.toolbar', periodControl(draw), typeSel, siteSel, q, h('span.spacer'), exp, h('button.btn.sm.primary', { onclick: () => openQuickAdd() }, '+ Add')), out);
  function draw() {
    const p = currentPeriod();
    const needle = ui.q.trim().toLowerCase();
    const list = dayBook(c, p).filter(v => (!ui.type || v.type === ui.type) && (!ui.site || (v.tags && v.tags.siteId) === ui.site || v.lines.some(l => (c.lById.get(l.ledgerId) || {}).siteId === ui.site))
      && (!needle || (v.narration || '').toLowerCase().includes(needle) || (v.no || '').toLowerCase().includes(needle) || v.lines.some(l => ((c.lById.get(l.ledgerId) || {}).name || '').toLowerCase().includes(needle) || String((l.dr || l.cr) / 100).startsWith(needle))));
    clear(out);
    const ledgerText = v => v.lines.map(l => (l.dr ? t('To ', 'Dr ') : t('From ', 'Cr ')) + ledgerName(c.lById.get(l.ledgerId))).join(', ');
    add(clear(exp), ...exportTable(t('Entries ', 'Day book ') + p.label, ['Date', 'No.', 'Kind', 'Note', t('Accounts', 'Ledgers'), 'Amount'], list.map(v => [v.date, v.no, kindName(v.type), v.narration, ledgerText(v), xr(v.lines.reduce((t, l) => t + l.dr, 0))])));
    if (!list.length) { add(out, h('div.card', h('div.empty', 'Nothing in this period.'))); return; }
    const shown = list.slice(0, 500);
    add(out, h('div.card', h('div.tbl-wrap', h('table.tbl',
      h('thead', h('tr', h('th', 'Date'), isCA() ? h('th.hide-sm', 'No.') : null, h('th', t('Details', 'Particulars')), h('th.hide-sm', t('Kind', 'Type')), h('th.r', 'Amount'), h('th.r', 'Cash / bank'))),
      h('tbody', shown.map(v => {
        const main = v.lines.find(l => !c.isMoney(l.ledgerId)) || v.lines[0];
        return h('tr.click', { onclick: () => openVoucher(v.id) },
          h('td.nowrap', fmtDate(v.date)), isCA() ? h('td.hide-sm.vno', v.no) : null,
          h('td', isCA() ? ledgerText(v) : ledgerName(c.lById.get(main.ledgerId)), !isCA() && v.lines.length > 2 ? h('span.muted.small', ' +' + (v.lines.length - 2)) : null, v.narration ? h('div.narr', v.narration) : null),
          h('td.hide-sm', h('span.pill', kindName(v.type))),
          h('td.r.amt', money(v.lines.reduce((t, l) => t + l.dr, 0))),
          h('td.r', amt(flow(c, v), { flow: true })));
      }))))),
    list.length > shown.length ? h('p.small.muted', `Showing the latest ${shown.length} of ${list.length}. Narrow the period or filter to see older entries.`) : h('p.small.muted', list.length + ' entr' + (list.length === 1 ? 'y' : 'ies')));
  }
  draw();
}
export { particulars };
