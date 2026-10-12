/* Money between family members (cash or bank, either direction). One form writes both people's records. */
import { h, clear, money, amt, add } from '../ui/dom.js';
import { openModal, toast, amountInput, dateInput, select, field } from '../ui/widgets.js';
import * as store from '../app/store.js';
import { S } from '../app/store.js';
import { balances } from '../core/books.js';
import { fmtDate, today, fyOf, fyRange } from '../lib/dates.js';
import { t } from '../ui/terms.js';

const people = () => store.sortedEntities().filter(e => e.kind !== 'demo');
function moneyAccounts(entityId) {
  const c = store.ctxOf(entityId);
  return c.ledgers.filter(l => !l.archived && ['cash', 'bank'].includes(c.natureOf(l)))
    .sort((a, b) => c.natureOf(a).localeCompare(c.natureOf(b)) || a.name.localeCompare(b.name))
    .map(l => ({ value: l.id, label: l.name }));
}

/* pairId: edit an existing transfer (it is replaced as a whole) */
export function openFamilyTransfer(pairId = '', preset = {}) {
  const ps = people();
  if (ps.length < 2) { toast('Add a second person first (Settings → People).'); return; }
  const old = pairId ? S.vouchers.filter(v => v.pairId === pairId) : [];
  const fam = old.length ? old[0].meta.family : null;
  const active = store.activeEntity();
  const me = ps.find(p => p.id === active.id) || ps[0];
  const st = {
    from: fam ? fam.fromEntityId : preset.from || me.id,
    to: fam ? fam.toEntityId : preset.to || (ps.find(p => p.id !== me.id) || ps[1]).id,
    kind: fam ? fam.kind : 'gift'
  };
  const outV = old.find(v => v.entityId === st.from), inV = old.find(v => v.entityId === st.to);
  const amount = amountInput(outV ? outV.lines[0].dr : 0, { autofocus: true });
  const date = dateInput(outV ? outV.date : today());
  const note = h('input.inp', { value: outV ? outV.narration : '', placeholder: 'Optional, e.g. household money for October' });
  const fromSel = select([], ''), toSel = select([], ''), fromAcc = select([], ''), toAcc = select([], '');
  const fillPeople = () => {
    fromSel.replaceChildren(...ps.map(p => h('option', { value: p.id }, p.name))); fromSel.value = st.from;
    toSel.replaceChildren(...ps.filter(p => p.id !== st.from).map(p => h('option', { value: p.id }, p.name)));
    if (st.to === st.from || !ps.some(p => p.id === st.to)) st.to = ps.find(p => p.id !== st.from).id;
    toSel.value = st.to;
    const fa = moneyAccounts(st.from), ta = moneyAccounts(st.to);
    const keepF = fromAcc.value, keepT = toAcc.value;
    fromAcc.replaceChildren(...fa.map(o => h('option', { value: o.value }, o.label)));
    toAcc.replaceChildren(...ta.map(o => h('option', { value: o.value }, o.label)));
    const pick = (sel, wanted) => { if (wanted && [...sel.options].some(o => o.value === wanted)) sel.value = wanted; };
    pick(fromAcc, keepF || (outV && outV.lines[1].ledgerId)); pick(toAcc, keepT || (inV && inV.lines[0].ledgerId));
    labelFrom.textContent = 'Paid from (' + nameOf(st.from) + ')';
    labelTo.textContent = 'Received in (' + nameOf(st.to) + ')';
  };
  const nameOf = id => (store.entityById(id) || {}).name || '';
  const labelFrom = h('span'), labelTo = h('span');
  fromSel.addEventListener('change', () => { st.from = fromSel.value; fillPeople(); });
  toSel.addEventListener('change', () => { st.to = toSel.value; fillPeople(); });
  const swap = h('button.btn.sm', { title: 'Swap direction', onclick: () => { [st.from, st.to] = [st.to, st.from]; fromAcc.value = ''; toAcc.value = ''; fillPeople(); } }, '⇄ Swap');
  const kindBox = h('div.grid');
  const drawKind = () => {
    clear(kindBox);
    for (const [k, label, hint] of [
      ['gift', 'Gift — not to be returned', 'Household money, gifts, money given to spend. Not counted as income or spending for either of you.'],
      ['loan', 'To be returned', 'You keep a running total of who owes whom.']]) {
      add(kindBox, h('label.check', h('input', { type: 'radio', name: 'famkind', checked: st.kind === k, onchange: () => { st.kind = k; } }), h('span', h('b', label), h('div.small.muted', hint))));
    }
  };
  drawKind();
  fillPeople();
  const body = h('div.grid',
    h('div.grid', { style: { gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'end' } }, field('Who gave', fromSel), swap, field('Who received', toSel)),
    h('div.grid.g2', field(labelFrom, fromAcc, 'cash or bank'), field(labelTo, toAcc, 'cash or bank')),
    h('div.grid.g3', field('Amount', amount), field('Date', date), field('Note', note)),
    kindBox,
    h('p.small.muted', t('It is saved in both people’s records at once. Editing or deleting it changes both.',
      'Posted in both books with one link. Gift: Dr drawings (giver) / Cr capital introduced (receiver) — not income; income earned on gifted money may be clubbed with the giver’s income. To be returned: inter-person current accounts, eliminated in the family view.')));
  const save = async () => {
    if (!fromAcc.value || !toAcc.value) return toast('Each person needs a cash or bank account');
    try {
      await store.saveFamilyTransfer({ fromEntityId: st.from, toEntityId: st.to, fromMoneyId: fromAcc.value, toMoneyId: toAcc.value, amount: amount.paise(), date: date.value, note: note.value.trim(), kind: st.kind, replacePairId: pairId });
      md.close();
      toast(`Saved: ${nameOf(st.from)} → ${nameOf(st.to)} ${money(amount.paise())}`);
    } catch (e) { toast(e.message); }
  };
  const md = openModal({
    title: pairId ? 'Edit family transfer' : 'Give / get money from family', size: 'wide', body,
    foot: [h('span.left.small.muted', 'Ctrl+Enter to save'), h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: save }, 'Save')]
  });
  md.el.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });
}

export function renderFamilyMoney(root) {
  const ps = people();
  const me = store.activeEntity();
  if (me.kind === 'demo') { add(root, h('div.note', 'Switch to You or Spouse to record money between family members.')); return; }
  if (ps.length < 2) { add(root, h('div.empty', 'Add a second person under Settings → People to record money between you.')); return; }
  const fy = fyOf(today()), r = fyRange(fy);
  const c = store.ctxOf(me.id);
  const bal = balances(c);
  add(root, h('div.toolbar', h('p.muted', { style: { margin: 0 } }, 'Cash or bank money you give each other. Saved in both people’s records at once.'), h('span.spacer'), h('button.btn.primary', { onclick: () => openFamilyTransfer() }, '+ Give / get money')));
  const pairs = S.vouchers.filter(v => v.entityId === me.id && v.src === 'family');
  for (const other of ps.filter(p => p.id !== me.id)) {
    const inter = c.ledgers.find(l => l.interEntityWith === other.id);
    const owed = inter ? bal.get(inter.id).closing : 0;
    const withOther = pairs.filter(v => { const f = v.meta.family; return f.fromEntityId === other.id || f.toEntityId === other.id; });
    const thisYear = withOther.filter(v => v.date >= r.from && v.date <= r.to);
    const sumOf = (list, dir, kind) => list.filter(v => (dir === 'out' ? v.meta.family.fromEntityId === me.id : v.meta.family.toEntityId === me.id) && (!kind || v.meta.family.kind === kind)).reduce((s, v) => s + v.lines[0].dr, 0);
    add(root, h('div.section-h', h('h2', me.name + ' and ' + other.name)),
      h('div.kpis',
        kpi('Gave to ' + other.name + ' · FY ' + fy, amt(sumOf(thisYear, 'out'))),
        kpi('Received from ' + other.name + ' · FY ' + fy, amt(sumOf(thisYear, 'in'))),
        kpi('Gifts given · FY ' + fy, amt(sumOf(thisYear, 'out', 'gift'))),
        kpi('To be returned', owed === 0 ? h('span', 'Nothing pending') : h('span', money(Math.abs(owed)), h('div.small.muted', owed > 0 ? other.name + ' → ' + me.name : me.name + ' → ' + other.name)))),
      withOther.length ? h('div.card', h('div.tbl-wrap', h('table.tbl',
        h('thead', h('tr', h('th', 'Date'), h('th', 'Direction'), h('th', 'My account'), h('th', 'Kind'), h('th.r', 'Amount'))),
        h('tbody', withOther.sort((a, b) => b.date.localeCompare(a.date)).map(v => {
          const out = v.meta.family.fromEntityId === me.id;
          const acc = c.lById.get((out ? v.lines[1] : v.lines[0]).ledgerId);
          return h('tr.click', { onclick: () => import('./entry.js').then(m => m.openVoucher(v.id)) },
            h('td.nowrap', fmtDate(v.date)), h('td', out ? me.name + ' → ' + other.name : other.name + ' → ' + me.name, v.narration ? h('div.narr', v.narration) : null),
            h('td', acc ? acc.name : '?'), h('td', h('span.pill', v.meta.family.kind === 'gift' ? 'gift' : 'to return')),
            h('td.r', amt(out ? -v.lines[0].dr : v.lines[0].dr, { flow: true })));
        })))))
        : h('div.card', h('div.empty', 'Nothing recorded yet.')));
  }
}
function kpi(lbl, val) { return h('div.card.kpi', h('div.lbl', lbl), h('div.val', { style: { fontSize: '17px' } }, val)); }
