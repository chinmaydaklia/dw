/* Masters: groups and ledgers (with tax tags, sites, TDS defaults, openings) and the ledger statement. */
import { h, clear, money, amt, drcr, add } from '../ui/dom.js';
import { openModal, toast, confirmBox, amountInput, select, field, exportTable, xr } from '../ui/widgets.js';
import { periodControl, currentPeriod, createLedgerDialog } from '../ui/pickers.js';
import * as store from '../app/store.js';
import { balances, ledgerStatement } from '../core/books.js';
import { ROOTS, ROOT_ORDER, TAX_TAGS, makeGroup, sectionFor } from '../core/masters.js';
import { openVoucher, openEntry } from './entry.js';
import { fmtDate, today, fyOf } from '../lib/dates.js';
import { toPaise } from '../lib/money.js';

const ui = { q: '', archived: false };
export function renderLedgers(root) {
  const c = store.ctx();
  const bal = balances(c, { to: today() });
  const out = h('div');
  add(root, h('div.toolbar',
    h('input.inp.sm', { placeholder: 'Filter ledgers', value: ui.q, style: { width: '220px' }, oninput: e => { ui.q = e.target.value; draw(); } }),
    h('label.check.small', h('input', { type: 'checkbox', checked: ui.archived, onchange: e => { ui.archived = e.target.checked; draw(); } }), 'Show archived'),
    h('span.spacer'),
    h('button.btn.sm', { onclick: () => editGroup(null) }, '+ Group'),
    h('button.btn.sm.primary', { onclick: () => createLedgerDialog(c.entity.id) }, '+ Ledger')), out);
  function draw() {
    clear(out);
    const q = ui.q.trim().toLowerCase();
    for (const root2 of ROOT_ORDER) {
      const groups = c.groups.filter(g => g.root === root2).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      const blocks = [];
      for (const g of groups) {
        const ls = c.ledgers.filter(l => l.groupId === g.id && (ui.archived || !l.archived) && (!q || (l.name + ' ' + l.alias).toLowerCase().includes(q))).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
        if (q && !ls.length) continue;
        const gt = ls.reduce((t, l) => t + bal.get(l.id).closing, 0);
        blocks.push(h('tr.grp', h('td', g.name, ' ', h('button.btn.ghost.sm', { onclick: () => editGroup(g), title: 'Edit group' }, '✎')), h('td.hide-sm'), h('td.r.amt', drcr(gt))));
        for (const l of ls) {
          const site = (c.entity.sites || []).find(s => s.id === l.siteId);
          blocks.push(h('tr.click', { onclick: () => { location.hash = '#/ledger/' + l.id; } },
            h('td.ind', l.name, l.archived ? h('span.pill', ' archived') : null, l.system === 'capital' ? h('span.muted.small', ' (balancing figure)') : null),
            h('td.hide-sm', h('span.small.muted', TAX_TAGS[l.taxTag] ? TAX_TAGS[l.taxTag].label : ''), site ? h('span.pill.gold', { style: { marginLeft: '6px' } }, site.name) : null, l.tdsBps ? h('span.pill', { style: { marginLeft: '6px' } }, 'TDS ' + l.tdsBps / 100 + '%') : null, l.interEntityWith ? h('span.pill', { style: { marginLeft: '6px' } }, 'inter-entity') : null),
            h('td.r.amt', drcr(bal.get(l.id).closing))));
        }
      }
      if (!blocks.length) continue;
      add(out, h('div.section-h', h('h2', ROOTS[root2].name)), h('div.card', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Ledger'), h('th.hide-sm', 'Tax tag / site'), h('th.r', 'Balance today'))), h('tbody', blocks)))));
    }
  }
  draw();
}

function editGroup(g) {
  const c = store.ctx();
  const isNew = !g;
  const name = h('input.inp', { value: g ? g.name : '' });
  const root = select(ROOT_ORDER.map(r => ({ value: r, label: ROOTS[r].name })), g ? g.root : 'expense', { disabled: !isNew });
  const md = openModal({
    title: isNew ? 'New group' : 'Edit group', body: h('div.grid', field('Name', name), field('Type', root, isNew ? 'Every group sits under one of five root types.' : 'The root type of an existing group cannot change.')),
    foot: [!isNew && !g.system ? h('button.btn.danger.left', { onclick: async () => { try { await store.deleteGroup(g.id); md.close(); toast('Group deleted'); } catch (e) { toast(e.message); } } }, 'Delete') : null,
      h('button.btn', { onclick: () => md.close() }, 'Cancel'),
      h('button.btn.primary', { onclick: async () => {
        if (!name.value.trim()) return toast('Enter a name');
        const rec = g ? { ...g, name: name.value.trim() } : makeGroup({ entityId: c.entity.id, name: name.value.trim(), root: root.value, nature: 'other' });
        await store.saveGroup(rec); md.close(); toast('Saved');
      } }, 'Save')]
  });
}

export function editLedger(l) {
  const c = store.ctxOf(l.entityId);
  const entity = store.entityById(l.entityId);
  const st = { ...l };
  const name = h('input.inp', { value: l.name });
  const alias = h('input.inp', { value: l.alias || '', placeholder: 'words for quick entry, e.g. “sbi”, “petrol”' });
  const groups = c.groups.slice().sort((a, b) => ROOT_ORDER.indexOf(a.root) - ROOT_ORDER.indexOf(b.root) || a.order - b.order);
  const grp = select(groups.map(g => ({ value: g.id, label: ROOTS[g.root].name + ' › ' + g.name })), l.groupId);
  const tag = select([], l.taxTag);
  const fillTags = () => { const g = c.gById.get(grp.value); tag.replaceChildren(...Object.entries(TAX_TAGS).filter(([, t]) => !g || t.roots.includes(g.root)).map(([k, t]) => h('option', { value: k }, t.label))); tag.value = st.taxTag; if (tag.value !== st.taxTag) tag.selectedIndex = 0; };
  grp.addEventListener('change', fillTags); fillTags();
  tag.addEventListener('change', () => { st.taxTag = tag.value; });
  const site = select([{ value: '', label: '— none —' }, ...(entity.sites || []).map(s => ({ value: s.id, label: s.name }))], l.siteId || '');
  const tds = h('input.inp', { type: 'number', step: '0.01', min: 0, max: 100, value: l.tdsBps ? l.tdsBps / 100 : '' });
  const openSide = select([{ value: 'dr', label: 'Dr (asset / expense side)' }, { value: 'cr', label: 'Cr (liability / income side)' }], (l.opening || 0) < 0 ? 'cr' : 'dr');
  const opening = amountInput(Math.abs(l.opening || 0));
  const note = h('textarea.inp', { rows: 2 }, l.note || '');
  const isCap = l.system === 'capital';
  const sec = sectionFor(l.taxTag, fyOf(today()));
  const md = openModal({
    title: 'Edit ledger', size: 'wide',
    body: h('div.grid.g2', field('Name', name), field('Alias', alias), field('Group', grp), field('Tax tag', tag, sec ? 'Section ' + sec + ' (tax year ' + fyOf(today()) + ')' : ''), field('Default site', site), field('Default TDS %', tds, 'Auto-fills TDS on income entries (e.g. 10 for hospital fees)'),
      isCap ? h('div.note.spanall', 'Opening capital is worked out automatically as assets − liabilities from all other opening balances, so the books always open balanced.')
        : h('div.grid.g2.spanall', field('Opening balance', opening, 'Balance on the day these books start'), field('Opening side', openSide)),
      h('div.spanall', field('Note', note))),
    foot: [
      !isCap ? h('button.btn.danger.left', { onclick: async () => { if (!(await confirmBox('Delete ledger?', 'Only possible when no entry uses it.', 'Delete', true))) return; try { await store.deleteLedger(l.id); md.close(); toast('Deleted'); location.hash = '#/ledgers'; } catch (e) { toast(e.message); } } }, 'Delete') : null,
      !isCap ? h('button.btn', { onclick: async () => { await store.saveLedger({ ...l, archived: !l.archived }); md.close(); toast(l.archived ? 'Restored' : 'Archived — hidden from pickers, history kept'); } }, l.archived ? 'Unarchive' : 'Archive') : null,
      h('button.btn', { onclick: () => md.close() }, 'Cancel'),
      h('button.btn.primary', { onclick: async () => {
        if (!name.value.trim()) return toast('Enter a name');
        const op = isCap ? (l.opening || 0) : (toPaise(opening.value) || 0) * (openSide.value === 'cr' ? -1 : 1);
        const tb = Math.round((parseFloat(tds.value) || 0) * 100);
        if (tb < 0 || tb > 10000) return toast('TDS % must be between 0 and 100');
        await store.saveLedger({ ...l, name: name.value.trim(), alias: alias.value.trim(), groupId: grp.value, taxTag: tag.value, siteId: site.value, tdsBps: tb, opening: op, note: note.value.trim() });
        md.close(); toast('Ledger saved');
      } }, 'Save')]
  });
}

export function renderLedger(root, id) {
  const c = store.ctx();
  const l = c.lById.get(id);
  if (!l) { add(root, h('div.empty', 'This ledger is not in the current entity. ', h('a', { href: '#/ledgers' }, 'All ledgers'))); return; }
  const g = c.groupOf(l) || {};
  const out = h('div');
  const exp = h('span.btnrow');
  const isMoney = ['cash', 'bank', 'card'].includes(g.nature);
  add(root, h('div.toolbar', h('a.btn.sm', { href: '#/ledgers' }, '← Ledgers'), h('span.muted', g.name + ' · ' + (TAX_TAGS[l.taxTag] || {}).label), periodControl(draw), h('span.spacer'), exp,
    isMoney ? h('button.btn.sm', { onclick: () => import('./importer.js').then(m => m.importStatement(l.id)) }, '⇩ Import statement') : null,
    h('button.btn.sm', { onclick: () => editLedger(l) }, 'Edit ledger')), out);
  function draw() {
    const p = currentPeriod();
    const st = ledgerStatement(c, id, p);
    clear(out);
    add(clear(exp), ...exportTable(l.name + ' ' + p.label, ['Date', 'No.', 'Particulars', 'Narration', 'Debit', 'Credit', 'Balance'],
      [[p.from, '', 'Opening balance', '', '', '', xr(st.opening)], ...st.rows.map(r => [r.date, r.voucher.no, r.particulars, r.voucher.narration, r.dr ? xr(r.dr) : '', r.cr ? xr(r.cr) : '', xr(r.balance)]), [p.to, '', 'Closing balance', '', xr(st.dr), xr(st.cr), xr(st.closing)]]));
    add(out, h('div.print-head', h('h2', l.name), h('div', store.activeEntity().name + ' · ' + p.label)),
      h('div.kpis', kpi('Opening', drcr(st.opening)), kpi('Debits', money(st.dr)), kpi('Credits', money(st.cr)), kpi('Closing', drcr(st.closing))));
    if (l.note) add(out, h('p.note', l.note));
    if (!st.rows.length) { add(out, h('div.card', h('div.empty', 'No entries in this period.'))); return; }
    add(out, h('div.card', h('div.tbl-wrap', h('table.tbl',
      h('thead', h('tr', h('th', 'Date'), h('th', 'Particulars'), h('th.hide-sm', 'No.'), h('th.r', 'Debit'), h('th.r', 'Credit'), h('th.r', 'Balance'))),
      h('tbody', h('tr', h('td', fmtDate(p.from)), h('td.muted', 'Opening balance'), h('td.hide-sm'), h('td'), h('td'), h('td.r.amt', drcr(st.opening))),
        st.rows.map(r => h('tr.click', { onclick: () => openVoucher(r.voucher.id) }, h('td.nowrap', fmtDate(r.date)), h('td', r.particulars, r.voucher.narration ? h('div.narr', r.voucher.narration) : null), h('td.hide-sm.vno', r.voucher.no), h('td.r.amt', r.dr ? money(r.dr) : ''), h('td.r.amt', r.cr ? money(r.cr) : ''), h('td.r.amt', drcr(r.balance))))),
      h('tfoot', h('tr', h('td'), h('td', 'Totals / closing'), h('td.hide-sm'), h('td.r.amt', money(st.dr)), h('td.r.amt', money(st.cr)), h('td.r.amt', drcr(st.closing))))))));
  }
  draw();
}
function kpi(lbl, val) { return h('div.card.kpi', h('div.lbl', lbl), h('div.val', { style: { fontSize: '17px' } }, val)); }
