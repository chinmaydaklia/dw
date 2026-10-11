/* Ledger pickers and the shared period selector. */
import { h, add } from './dom.js';
import { openModal, select, field, toast, combo } from './widgets.js';
import * as store from '../app/store.js';
import { makeLedger, defaultTag, TAX_TAGS, ROOTS, ROOT_ORDER } from '../core/masters.js';
import { fyList, fyRange, fyOf, today, fyShift, addDays } from '../lib/dates.js';
import { t, groupName, ledgerName } from './terms.js';

/* filter: 'money' (cash/bank), 'pay' (cash/bank/card), 'income', 'expense', 'invest', 'loanTaken', 'loanGiven', 'all', or a function */
export function ledgerItems(ctx, filter = 'all') {
  const f = typeof filter === 'function' ? filter : FILTERS[filter] || FILTERS.all;
  return ctx.ledgers.filter(l => !l.archived && f(l, ctx)).map(l => ({ id: l.id, label: ledgerName(l), group: groupName(ctx.groupOf(l)), alias: l.alias || '' }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
}
const nat = (l, c) => c.natureOf(l);
const FILTERS = {
  all: () => true,
  money: (l, c) => ['cash', 'bank'].includes(nat(l, c)),
  pay: (l, c) => ['cash', 'bank', 'card'].includes(nat(l, c)),
  income: (l, c) => c.rootOf(l) === 'income',
  expense: (l, c) => c.rootOf(l) === 'expense',
  invest: (l, c) => ['investment', 'fixed'].includes(nat(l, c)),
  loanTaken: (l, c) => c.rootOf(l) === 'liability' && nat(l, c) !== 'card',
  loanGiven: (l, c) => ['advance'].includes(nat(l, c)),
  nonMoney: (l, c) => !['cash', 'bank'].includes(nat(l, c))
};
/* Restrict group choices for a filter when creating a ledger inline */
const CREATE_ROOT = { income: 'income', expense: 'expense', invest: 'asset', money: 'asset', pay: 'asset', loanTaken: 'liability', loanGiven: 'asset' };

export function ledgerCombo(ctx, filter, value, onPick, opts = {}) {
  const c = combo(ledgerItems(ctx, filter), value, onPick, {
    ...opts,
    onCreate: name => createLedgerDialog(ctx.entity.id, name, CREATE_ROOT[filter]),
    refresh: () => ledgerItems(store.ctxOf(ctx.entity.id), filter)
  });
  return c;
}

/* Small dialog to create a ledger in a chosen group. Resolves to the new ledger id or null. */
export function createLedgerDialog(entityId, name = '', root = '') {
  return new Promise(resolve => {
    const groups = store.S.groups.filter(g => g.entityId === entityId && (!root || g.root === root))
      .sort((a, b) => ROOT_ORDER.indexOf(a.root) - ROOT_ORDER.indexOf(b.root) || a.order - b.order);
    const nm = h('input.inp', { value: name, autofocus: true });
    const gs = select(groups.map(g => ({ value: g.id, label: groupName(g) })), groups[0] && groups[0].id);
    const tagSel = select([], '');
    const fillTags = () => {
      const g = groups.find(x => x.id === gs.value);
      const opts = Object.entries(TAX_TAGS).filter(([, t]) => !g || t.roots.includes(g.root)).map(([k, t]) => ({ value: k, label: t.label }));
      tagSel.replaceChildren(...opts.map(o => h('option', { value: o.value }, o.label)));
      tagSel.value = defaultTag(g);
    };
    gs.addEventListener('change', fillTags); fillTags();
    let done = false;
    const save = async () => {
      if (!nm.value.trim()) { toast('Enter a name'); return; }
      const l = makeLedger({ entityId, groupId: gs.value, name: nm.value.trim(), taxTag: tagSel.value });
      await store.saveLedger(l);
      done = true; md.close(); toast('Created'); resolve(l.id);
    };
    nm.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    const md = openModal({
      title: t('New account / category', 'New ledger'), body: h('div.grid', field('Name', nm), field(t('Section', 'Group'), gs), field(t('Tax treatment', 'Tax tag'), tagSel)),
      foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: save }, 'Create')],
      onClose: () => { if (!done) resolve(null); }
    });
  });
}

/* ---------- period ---------- */
export const period = { mode: 'fy', fy: '', from: '', to: '', compare: false };
export function currentPeriod() {
  if (!period.fy) period.fy = store.S.settings.fy || fyOf(today());
  if (period.mode === 'fy') { const r = fyRange(period.fy); return { ...r, label: 'FY ' + period.fy, fy: period.fy }; }
  return { from: period.from, to: period.to, label: period.from + ' → ' + period.to };
}
/* the comparison period of equal length immediately before (YoY for a financial year) */
export function priorPeriod(p) {
  if (period.mode === 'fy') { const fy = fyShift(period.fy, -1); return { ...fyRange(fy), label: 'FY ' + fy }; }
  const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 864e5);
  const to = addDays(p.from, -1);
  return { from: addDays(to, -days), to, label: 'previous period' };
}
export function periodControl(onChange, { allowCompare = false } = {}) {
  currentPeriod();
  const wrap = h('div.btnrow');
  const fySel = select(fyList(6, 1).map(f => ({ value: f, label: 'FY ' + f })), period.fy, { class: 'inp sm', style: { width: 'auto' } });
  const modeSel = select([{ value: 'fy', label: 'Financial year' }, { value: 'custom', label: 'Choose dates' }], period.mode, { class: 'inp sm', style: { width: 'auto' } });
  const from = h('input.inp.sm', { type: 'date', value: period.from || fyRange(period.fy).from, style: { width: 'auto' } });
  const to = h('input.inp.sm', { type: 'date', value: period.to || today(), style: { width: 'auto' } });
  const cmp = h('label.check.small', h('input', { type: 'checkbox', checked: period.compare, onchange: e => { period.compare = e.target.checked; onChange(); } }), 'Compare with previous');
  const sync = () => { fySel.classList.toggle('hide', period.mode !== 'fy'); from.classList.toggle('hide', period.mode === 'fy'); to.classList.toggle('hide', period.mode === 'fy'); };
  modeSel.addEventListener('change', () => { period.mode = modeSel.value; if (period.mode === 'custom' && !period.from) { period.from = from.value; period.to = to.value; } sync(); onChange(); });
  fySel.addEventListener('change', () => { period.fy = fySel.value; store.setSettings({ fy: period.fy }); onChange(); });
  from.addEventListener('change', () => { period.from = from.value; onChange(); });
  to.addEventListener('change', () => { period.to = to.value; onChange(); });
  sync();
  add(wrap, modeSel, fySel, from, to);
  if (allowCompare) add(wrap, cmp);
  return wrap;
}
