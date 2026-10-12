/* Masters: groups and ledgers (with tax tags, sites, TDS defaults, openings) and the ledger statement. */
import { h, clear, money, amt, drcr, add } from '../ui/dom.js';
import { openModal, toast, confirmBox, amountInput, select, field, exportTable, xr } from '../ui/widgets.js';
import { periodControl, currentPeriod, createLedgerDialog } from '../ui/pickers.js';
import * as store from '../app/store.js';
import { balances, ledgerStatement } from '../core/books.js';
import { ROOTS, ROOT_ORDER, TAX_TAGS, makeGroup, sectionFor } from '../core/masters.js';
import { openVoucher, openEntry } from './entry.js';
import { fmtDate, today, fyOf } from '../lib/dates.js';
import { t, isCA, groupName, ledgerName } from '../ui/terms.js';
import { toPaise } from '../lib/money.js';

const ui = { q: '', archived: false };
export function renderLedgers(root) {
  const c = store.ctx();
  const bal = balances(c, { to: today() });
  const out = h('div');
  add(root, h('div.toolbar',
    h('input.inp.sm', { placeholder: t('Search accounts & categories', 'Filter ledgers'), value: ui.q, style: { width: '220px' }, oninput: e => { ui.q = e.target.value; draw(); } }),
    h('label.check.small', h('input', { type: 'checkbox', checked: ui.archived, onchange: e => { ui.archived = e.target.checked; draw(); } }), 'Show hidden'),
    h('span.spacer'),
    h('button.btn.sm', { onclick: () => editGroup(null) }, t('+ Section', '+ Group')),
    h('button.btn.sm.primary', { onclick: () => createLedgerDialog(c.entity.id) }, t('+ Account / category', '+ Ledger'))), out);
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
        blocks.push(h('tr.grp', h('td', groupName(g), ' ', h('button.btn.ghost.sm', { onclick: () => editGroup(g), title: t('Rename section', 'Edit group'), 'aria-label': 'Rename section ' + g.name }, '✎')), h('td.hide-sm'), h('td.r.amt', showBal(gt, g.root)), h('td')));
        for (const l of ls) {
          const site = (c.entity.sites || []).find(s => s.id === l.siteId);
          blocks.push(h('tr.click', { onclick: () => { location.hash = (isCA() ? '#/ca-ledger/' : '#/ledger/') + l.id; } },
            h('td.ind', ledgerName(l), l.archived ? h('span.pill', ' hidden') : null, l.system === 'capital' ? h('span.muted.small', t(' (worked out automatically)', ' (balancing figure)')) : null),
            h('td.hide-sm', h('span.small.muted', TAX_TAGS[l.taxTag] ? TAX_TAGS[l.taxTag].label : ''), site ? h('span.pill.gold', { style: { marginLeft: '6px' } }, site.name) : null, l.tdsBps ? h('span.pill', { style: { marginLeft: '6px' } }, 'TDS ' + l.tdsBps / 100 + '%') : null, l.interEntityWith ? h('span.pill', { style: { marginLeft: '6px' } }, t('family', 'inter-entity')) : null),
            h('td.r.amt', showBal(bal.get(l.id).closing, root2)),
            /* edit straight from the list (clicking the row opens its history) */
            h('td.r', { style: { width: '1%' } }, h('button.btn.sm', { title: 'Rename, move to another section, tax treatment, starting balance', 'aria-label': 'Edit ' + l.name, onclick: ev => { ev.stopPropagation(); editLedger(l); } }, '✎ Edit'))));
        }
      }
      if (!blocks.length) continue;
      add(out, h('div.section-h', h('h2', t(PLAIN_ROOT[root2], ROOTS[root2].name))), h('div.card', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', t('Name', 'Ledger')), h('th.hide-sm', t('Tax treatment / site', 'Tax tag / site')), h('th.r', t('Today', 'Balance today')), h('th'))), h('tbody', blocks)))));
    }
  }
  draw();
}

function editGroup(g) {
  const c = store.ctx();
  const isNew = !g;
  const name = h('input.inp', { value: g ? g.name : '' });
  const root = select(ROOT_ORDER.map(r => ({ value: r, label: t(PLAIN_ROOT[r], ROOTS[r].name) })), g ? g.root : 'expense', { disabled: !isNew });
  const md = openModal({
    title: isNew ? t('New section', 'New group') : t('Rename section', 'Edit group'), body: h('div.grid', field('Name', name), field(t('This section holds', 'Root type'), root, isNew ? '' : 'Cannot change after it is created.')),
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
  const alias = h('input.inp', { value: l.alias || '', placeholder: 'short words you type in quick entry, e.g. “sbi”, “petrol”' });
  const groups = c.groups.slice().sort((a, b) => ROOT_ORDER.indexOf(a.root) - ROOT_ORDER.indexOf(b.root) || a.order - b.order);
  const grp = select(groups.map(g => ({ value: g.id, label: t(PLAIN_ROOT[g.root], ROOTS[g.root].name) + ' › ' + groupName(g) })), l.groupId);
  const tag = select([], l.taxTag);
  const fillTags = () => { const g = c.gById.get(grp.value); tag.replaceChildren(...Object.entries(TAX_TAGS).filter(([, t]) => !g || t.roots.includes(g.root)).map(([k, t]) => h('option', { value: k }, t.label))); tag.value = st.taxTag; if (tag.value !== st.taxTag) tag.selectedIndex = 0; };
  grp.addEventListener('change', fillTags); fillTags();
  tag.addEventListener('change', () => { st.taxTag = tag.value; });
  const site = select([{ value: '', label: '— none —' }, ...(entity.sites || []).map(s => ({ value: s.id, label: s.name }))], l.siteId || '');
  const tds = h('input.inp', { type: 'number', step: '0.01', min: 0, max: 100, value: l.tdsBps ? l.tdsBps / 100 : '' });
  const openSide = select([{ value: 'dr', label: t('I have this much / it is owed to me', 'Dr (asset / expense side)') }, { value: 'cr', label: t('I owe this much', 'Cr (liability / income side)') }], (l.opening || 0) < 0 ? 'cr' : 'dr');
  const opening = amountInput(Math.abs(l.opening || 0));
  const note = h('textarea.inp', { rows: 2 }, l.note || '');
  const isCap = l.system === 'capital';
  const sec = sectionFor(l.taxTag, fyOf(today()));
  const md = openModal({
    title: t('Edit account / category', 'Edit ledger'), size: 'wide',
    body: h('div.grid.g2', field('Name', name), field('Quick-entry words', alias), field(t('Section', 'Group'), grp), field(t('Tax treatment', 'Tax tag'), tag, sec ? 'Section ' + sec + ' (tax year ' + fyOf(today()) + ')' : ''), field('Default site', site), field('Usual TDS %', tds, 'Fills in TDS automatically (e.g. 10 for hospital fees)'),
      isCap ? h('div.note.spanall', t('Worked out automatically: everything you had minus everything you owed on the day you started.', 'Opening capital is the balancing figure of all other opening balances, so the books always open balanced.'))
        : h('div.grid.g2.spanall', field(t('Balance when I started', 'Opening balance'), opening, t('What it stood at on the day you began using this app', 'Balance on the day these books start')), field(t('This means', 'Opening side'), openSide)),
      h('div.spanall', field('Note', note))),
    foot: [
      !isCap ? h('button.btn.danger.left', { onclick: async () => { if (!(await confirmBox('Delete?', 'Only possible when no entry uses it. Otherwise hide it instead.', 'Delete', true))) return; try { await store.deleteLedger(l.id); md.close(); toast('Deleted'); location.hash = '#/ledgers'; } catch (e) { toast(e.message); } } }, 'Delete') : null,
      !isCap ? h('button.btn', { onclick: async () => { await store.saveLedger({ ...l, archived: !l.archived }); md.close(); toast(l.archived ? 'Shown again' : 'Hidden from lists — its history is kept'); } }, l.archived ? 'Show again' : 'Hide') : null,
      h('button.btn', { onclick: () => md.close() }, 'Cancel'),
      h('button.btn.primary', { onclick: async () => {
        if (!name.value.trim()) return toast('Enter a name');
        const op = isCap ? (l.opening || 0) : (toPaise(opening.value) || 0) * (openSide.value === 'cr' ? -1 : 1);
        const tb = Math.round((parseFloat(tds.value) || 0) * 100);
        if (tb < 0 || tb > 10000) return toast('TDS % must be between 0 and 100');
        await store.saveLedger({ ...l, name: name.value.trim(), alias: alias.value.trim(), groupId: grp.value, taxTag: tag.value, siteId: site.value, tdsBps: tb, opening: op, note: note.value.trim() });
        md.close(); toast('Saved');
      } }, 'Save')]
  });
}

export function renderLedger(root, id) {
  const c = store.ctx();
  const l = c.lById.get(id);
  if (!l) { add(root, h('div.empty', 'This account belongs to another person. ', h('a', { href: '#/ledgers' }, 'All accounts'))); return; }
  const g = c.groupOf(l) || {};
  const out = h('div');
  const exp = h('span.btnrow');
  const isMoney = ['cash', 'bank', 'card'].includes(g.nature);
  add(root, h('div.toolbar', h('a.btn.sm', { href: isCA() ? '#/ca-ledgers' : '#/ledgers' }, '← ' + t('Accounts', 'Ledgers')), h('span.muted', groupName(g) + ' · ' + (TAX_TAGS[l.taxTag] || {}).label), periodControl(draw), h('span.spacer'), exp,
    isMoney ? h('button.btn.sm', { onclick: () => import('./importer.js').then(m => m.importStatement(l.id)) }, '⇩ Import statement') : null,
    h('button.btn.sm.primary', { onclick: () => editLedger(l) }, '✎ Edit')), out);
  function draw() {
    const p = currentPeriod();
    const st = ledgerStatement(c, id, p);
    const sign = NATURAL[c.rootOf(l)] || 1;
    const [inL, outL] = isCA() ? ['Debit', 'Credit'] : words(c.natureOf(l), c.rootOf(l));
    const up = r => (sign > 0 ? r.dr : r.cr), down = r => (sign > 0 ? r.cr : r.dr);
    const balTxt = v => (isCA() ? drcr(v) : money(v * sign));
    clear(out);
    add(clear(exp), ...exportTable(l.name + ' ' + p.label, ['Date', t('Details', 'Particulars'), t('Note', 'Narration'), inL, outL, 'Balance'],
      [[p.from, t('Balance at start', 'Opening balance'), '', '', '', xr(st.opening * (isCA() ? 1 : sign))], ...st.rows.map(r => [r.date, r.particulars, r.voucher.narration, up(r) ? xr(up(r)) : '', down(r) ? xr(down(r)) : '', xr(r.balance * (isCA() ? 1 : sign))]), [p.to, t('Balance at end', 'Closing balance'), '', xr(sign > 0 ? st.dr : st.cr), xr(sign > 0 ? st.cr : st.dr), xr(st.closing * (isCA() ? 1 : sign))]]));
    add(out, h('div.print-head', h('h2', ledgerName(l)), h('div', store.activeEntity().name + ' · ' + p.label)),
      h('div.kpis', kpi(t('At start', 'Opening'), balTxt(st.opening)), kpi(inL, money(sign > 0 ? st.dr : st.cr)), kpi(outL, money(sign > 0 ? st.cr : st.dr)), kpi(t('Now', 'Closing'), balTxt(st.closing))));
    if (l.note) add(out, h('p.note', l.note));
    if (!st.rows.length) { add(out, h('div.card', h('div.empty', 'Nothing in this period.'))); return; }
    add(out, h('div.card', h('div.tbl-wrap', h('table.tbl',
      h('thead', h('tr', h('th', 'Date'), h('th', t('Details', 'Particulars')), isCA() ? h('th.hide-sm', 'No.') : null, h('th.r', inL), h('th.r', outL), h('th.r', 'Balance'))),
      h('tbody', h('tr', h('td', fmtDate(p.from)), h('td.muted', t('Balance at start', 'Opening balance')), isCA() ? h('td.hide-sm') : null, h('td'), h('td'), h('td.r.amt', balTxt(st.opening))),
        st.rows.map(r => h('tr.click', { onclick: () => openVoucher(r.voucher.id) }, h('td.nowrap', fmtDate(r.date)), h('td', r.particulars, r.voucher.narration ? h('div.narr', r.voucher.narration) : null), isCA() ? h('td.hide-sm.vno', r.voucher.no) : null, h('td.r.amt', up(r) ? money(up(r)) : ''), h('td.r.amt', down(r) ? money(down(r)) : ''), h('td.r.amt', balTxt(r.balance))))),
      h('tfoot', h('tr', h('td'), h('td', t('Totals / now', 'Totals / closing')), isCA() ? h('td.hide-sm') : null, h('td.r.amt', money(sign > 0 ? st.dr : st.cr)), h('td.r.amt', money(sign > 0 ? st.cr : st.dr)), h('td.r.amt', balTxt(st.closing))))))));
  }
  draw();
}
function kpi(lbl, val) { return h('div.card.kpi', h('div.lbl', lbl), h('div.val', { style: { fontSize: '17px' } }, val)); }

/* Plain wording: show balances the natural way round (a loan as "what I owe", income as "earned"). */
const PLAIN_ROOT = { asset: 'What I own', liability: 'What I owe', capital: 'Net worth', income: 'Income', expense: 'Spending' };
const NATURAL = { asset: 1, expense: 1, liability: -1, capital: -1, income: -1 };
function showBal(v, root) {
  if (isCA()) return drcr(v);
  return money(v * (NATURAL[root] || 1));
}
function words(nature, root) {
  if (nature === 'cash' || nature === 'bank') return ['Money in', 'Money out'];
  if (nature === 'card') return ['Spent on card', 'Paid back'];
  if (nature === 'loan') return ['Borrowed', 'Repaid'];
  if (nature === 'advance') return ['Lent / paid', 'Got back'];
  if (root === 'income') return ['Earned', 'Reduced'];
  if (root === 'expense') return ['Spent', 'Refund'];
  if (root === 'liability') return ['Owed more', 'Paid off'];
  if (root === 'capital') return ['Added', 'Taken out'];
  return ['Added', 'Reduced'];
}
