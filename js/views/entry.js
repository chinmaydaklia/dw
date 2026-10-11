/* Entry: quick one-line add, simple screens on top of double entry, full voucher form (pro), voucher view. */
import { h, clear, money, amt, drcr, add } from '../ui/dom.js';
import { openModal, toast, confirmBox, amountInput, dateInput, select, field } from '../ui/widgets.js';
import { ledgerCombo } from '../ui/pickers.js';
import * as store from '../app/store.js';
import { S } from '../app/store.js';
import { buildIncome, buildExpense, buildTransfer, buildInvestment, buildLoan, buildDailySummary, buildJournal, tidyLines, inferType, VTYPES, newVoucher } from '../core/vouchers.js';
import { parseQuick } from '../core/quick.js';
import { makeLedger } from '../core/masters.js';
import { pctOf, formatINR } from '../lib/money.js';
import { today, fmtDate, addDays } from '../lib/dates.js';
import { debounce, clone } from '../lib/util.js';

const KINDS = [['income', '↓ Income', 'F6'], ['expense', '↑ Expense', 'F5'], ['transfer', '⇄ Transfer', 'F4'], ['investment', '◆ Investment', ''], ['loan', '⚖ Loan', ''], ['daily', '✚ Daily summary', '']];
let lastDate = today();

/* ---------- quick add ---------- */
export function quickBar(onDone) {
  const c0 = store.ctx();
  const inp = h('input.inp', { placeholder: 'Quick entry — e.g. “450 petrol sbi”, “+18k pnh”, “5000 sbi to cash”, “y 1200 groceries card”', 'aria-label': 'Quick entry', autocomplete: 'off' });
  const prev = h('div.quick-preview');
  const defId = () => S.settings.defaultMoney[store.activeEntity().id] || (c0.ledgers.find(l => l.name === 'Cash in Hand') || {}).id;
  let res = null;
  const update = () => {
    const c = store.ctx();
    res = inp.value.trim() ? parseQuick(c, inp.value, { defaultMoneyId: defId() }) : null;
    clear(prev);
    if (!res) { add(prev, 'Enter to save · Tab for the full form · amounts like 12k or 1.5L work'); return; }
    if (res.error) { add(prev, h('span.warn-t', res.error)); return; }
    add(prev, h('b', money(res.amount)), ' · ', res.explain, ' · ', fmtDate(res.date), res.draft.narration ? ' · “' + res.draft.narration + '”' : '', ' · ', h('span.pill', VTYPES[res.draft.type].name));
  };
  inp.addEventListener('input', debounce(update, 80));
  inp.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      e.preventDefault(); update();
      if (!res || res.error) { toast(res ? res.error : 'Type an entry first'); return; }
      try {
        const v = await store.saveVoucher(newVoucher(store.activeEntity().id, res.draft));
        inp.value = ''; update();
        toast('Saved ' + v.no, { label: 'Undo', fn: () => store.deleteVoucher(v.id) });
        if (onDone) onDone(v);
      } catch (err) { toast(err.message); }
    } else if (e.key === 'Tab' && res && !res.error) {
      e.preventDefault(); openJournal(store.activeEntity().id, res.draft);
    }
  });
  update();
  const wrap = h('div', h('div.quick', inp, h('button.btn.primary', { onclick: () => inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) }, 'Save')), prev);
  wrap.focus = () => inp.focus();
  return wrap;
}

export function openQuickAdd() {
  const qb = quickBar(() => md.close());
  const md = openModal({
    title: 'Add entry', size: 'wide',
    body: h('div', qb, h('div.section-h', h('h2.small.muted', 'Or use a screen')),
      h('div.chips', KINDS.map(([k, label, key]) => h('button.chip', { onclick: () => { md.close(); openEntry(k); } }, label, key ? h('span.muted.small', ' ' + key) : null)),
        S.settings.proMode ? h('button.chip', { onclick: () => { md.close(); openEntry('journal'); } }, '✎ Journal F7') : null),
      shortcutChips(() => md.close()))
  });
  setTimeout(() => qb.focus(), 40);
}
function shortcutChips(close) {
  const list = S.shortcuts.filter(s => s.entityId === store.activeEntity().id);
  if (!list.length) return null;
  return h('div', h('div.section-h', h('h2.small.muted', 'Saved shortcuts')), h('div.chips', list.map(s => h('button.chip', { onclick: () => { close(); openJournal(s.entityId, { ...clone(s.template), date: today() }, { title: s.name }); } }, '★ ' + s.name))));
}

/* ---------- simple screens ---------- */
export function openEntry(kind, preset = {}) {
  if (kind === 'journal') return openJournal(store.activeEntity().id, preset.draft || null);
  const entity = store.activeEntity();
  const c = store.ctxOf(entity.id);
  if (kind === 'investment' && !c.ledgers.some(l => l.taxTag === 'capital_gain')) { ensureGainLedger(c).then(() => openEntry(kind, preset)); return; }
  const st = { date: preset.date || lastDate, narration: '', siteId: '', owner: '', custom: '' };
  const body = h('div');
  const previewEl = h('div.vpreview');
  let build = () => null;
  const L = name => (c.ledgers.find(l => l.name === name && !l.archived) || {}).id || '';
  const firstOf = filter => { const it = c.ledgers.find(l => !l.archived && filter(l)); return it ? it.id : ''; };
  const defMoney = S.settings.defaultMoney[entity.id] || L('Cash in Hand') || firstOf(l => ['bank', 'cash'].includes(c.natureOf(l)));
  const siteSel = select([{ value: '', label: '— no site —' }, ...(entity.sites || []).map(s => ({ value: s.id, label: s.name }))], '', { onchange: e => { st.siteId = e.target.value; refresh(); } });
  const ownerSel = select([{ value: '', label: '— owner —' }, ...S.settings.owners.map(o => ({ value: o, label: o }))], '', { onchange: e => { st.owner = e.target.value; } });
  const customInp = h('input.inp', { placeholder: 'tags, comma separated', onchange: e => { st.custom = e.target.value; } });
  const dateEl = dateInput(st.date, { onchange: e => { st.date = e.target.value; refresh(); } });
  const narrEl = h('input.inp', { placeholder: 'Narration (optional)', oninput: e => { st.narration = e.target.value; } });
  const setSiteFromLedger = id => { const l = c.lById.get(id); if (l && l.siteId) { st.siteId = l.siteId; siteSel.value = l.siteId; } };
  const tags = () => ({ siteId: st.siteId, owner: st.owner, custom: st.custom.split(',').map(s => s.trim()).filter(Boolean) });

  const forms = {
    income() {
      const s = { inc: preset.incomeLedgerId || '', money: preset.moneyLedgerId || defMoney, tdsOn: false, split: false, money2: L('Cash in Hand') };
      const gross = amountInput(preset.amount, { oninput: () => { autoTds(); refresh(); } });
      const tds = amountInput(0, { oninput: refresh });
      const cashPart = amountInput(0, { oninput: refresh });
      const tdsWrap = h('div');
      const autoTds = () => { const l = c.lById.get(s.inc); if (s.tdsOn && l && l.tdsBps) tds.value = (pctOf(gross.paise(), l.tdsBps) / 100).toString(); };
      const tdsChk = h('input', { type: 'checkbox', onchange: e => { s.tdsOn = e.target.checked; tdsWrap.classList.toggle('hide', !s.tdsOn); autoTds(); refresh(); } });
      const splitChk = h('input', { type: 'checkbox', onchange: e => { s.split = e.target.checked; splitWrap.classList.toggle('hide', !s.split); refresh(); } });
      const splitWrap = h('div.grid.g2.hide', field('Of which received in cash', cashPart), field('Cash ledger', ledgerCombo(c, 'money', s.money2, id => { s.money2 = id; refresh(); })));
      add(tdsWrap, h('div.grid.g2', field('TDS deducted', tds, 'Gross − TDS = amount received'), h('div.small.muted', { style: { alignSelf: 'end' } }, 'Booked to TDS Receivable (claimed against tax).')));
      tdsWrap.classList.add('hide');
      const moneyCombo = ledgerCombo(c, 'money', s.money, id => { s.money = id; refresh(); });
      /* hospital fees (TDS) arrive by bank transfer: switch a cash default to the first bank */
      const bankFor = l => { if (l && l.tdsBps && c.natureOf(c.lById.get(s.money) || {}) === 'cash') { const b = defaultDigital(c); if (b) { s.money = b; moneyCombo.set(b); } } };
      add(body, h('div.grid.g2',
        field('Income ledger', ledgerCombo(c, 'income', s.inc, id => { s.inc = id; const l = c.lById.get(id); setSiteFromLedger(id); if (l && l.tdsBps) { s.tdsOn = true; tdsChk.checked = true; tdsWrap.classList.remove('hide'); autoTds(); } bankFor(l); refresh(); }, { required: true })),
        field('Gross amount', gross),
        field('Received in', moneyCombo),
        h('div.grid', { style: { alignContent: 'end' } }, h('label.check', tdsChk, 'TDS was deducted'), h('label.check', splitChk, 'Part cash, part digital'))),
        tdsWrap, splitWrap);
      build = () => {
        const g = gross.paise(), t = s.tdsOn ? tds.paise() : 0;
        if (!s.inc || !g) return null;
        const p = { date: st.date, incomeLedgerId: s.inc, moneyLedgerId: s.money, tdsLedgerId: c.ledgers.find(l => l.taxTag === 'tds_receivable').id, gross: g, tds: t, narration: st.narration, tags: tags() };
        if (s.split && cashPart.paise()) p.split = [{ ledgerId: s.money2, amount: cashPart.paise() }, { ledgerId: s.money, amount: g - t - cashPart.paise() }];
        return buildIncome(c, p);
      };
      setTimeout(() => body.querySelector('input').focus(), 40);
    },
    expense() {
      const s = { money: preset.moneyLedgerId || defMoney, splits: [{ ledgerId: preset.expenseLedgerId || '', amount: preset.amount || 0 }] };
      const rows = h('div.grid');
      const drawRows = () => {
        clear(rows);
        s.splits.forEach((sp, i) => {
          const a = amountInput(sp.amount, { oninput: () => { sp.amount = a.paise(); refresh(); } });
          add(rows, h('div.grid', { style: { gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) auto' } },
            field(i === 0 ? 'Expense ledger' : 'Split ' + (i + 1), ledgerCombo(c, l => ['expense'].includes(c.rootOf(l)) || ['investment', 'fixed', 'advance', 'taxasset'].includes(c.natureOf(l)), sp.ledgerId, id => { sp.ledgerId = id; setSiteFromLedger(id); refresh(); })),
            field(i === 0 ? 'Amount' : 'Amount', a),
            h('div', { style: { alignSelf: 'end' } }, s.splits.length > 1 ? h('button.btn.ghost.icon', { title: 'Remove split', onclick: () => { s.splits.splice(i, 1); drawRows(); refresh(); } }, '✕') : h('span'))));
        });
      };
      drawRows();
      add(body, h('div.grid.g2', field('Paid from', ledgerCombo(c, 'pay', s.money, id => { s.money = id; refresh(); }))), rows,
        h('div', { style: { marginTop: '6px' } }, h('button.btn.sm', { onclick: () => { s.splits.push({ ledgerId: '', amount: 0 }); drawRows(); } }, '+ Split across another ledger')));
      build = () => {
        const sp = s.splits.filter(x => x.ledgerId && x.amount);
        if (!sp.length || !s.money) return null;
        return buildExpense(c, { date: st.date, moneyLedgerId: s.money, splits: sp, narration: st.narration, tags: tags() });
      };
    },
    transfer() {
      const s = { from: preset.fromLedgerId || '', to: preset.toLedgerId || '' };
      const a = amountInput(preset.amount, { oninput: refresh });
      add(body, h('div.grid.g3', field('From', ledgerCombo(c, 'all', s.from, id => { s.from = id; refresh(); })), field('To', ledgerCombo(c, 'all', s.to, id => { s.to = id; refresh(); })), field('Amount', a)),
        h('p.small.muted', 'Bank ↔ cash, card bill payments, FD placement, advance tax, moving money to the Zerodha fund account, or between entities via their current account.'));
      build = () => (s.from && s.to && a.paise() && s.from !== s.to ? buildTransfer(c, { date: st.date, fromLedgerId: s.from, toLedgerId: s.to, amount: a.paise(), narration: st.narration, tags: tags() }) : null);
    },
    investment() {
      const s = { kind: 'invest', inv: '', money: defMoney, gain: '', income: '' };
      const a = amountInput(0, { oninput: refresh }), cost = amountInput(0, { oninput: refresh });
      const seg = h('div.seg', [['invest', 'Invest / buy'], ['redeem', 'Redeem / sell'], ['income', 'Dividend / interest']].map(([k, lbl]) => h('button', { class: k === s.kind ? 'on' : '', onclick: e => { s.kind = k; seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.target)); draw(); } }, lbl)));
      const inner = h('div');
      const draw = () => {
        clear(inner);
        if (s.kind === 'income') {
          add(inner, h('div.grid.g3', field('Income ledger', ledgerCombo(c, 'income', s.income || L('Dividend'), id => { s.income = id; refresh(); })), field('Received in', ledgerCombo(c, 'money', s.money, id => { s.money = id; refresh(); })), field('Amount', a)));
          s.income = s.income || L('Dividend');
        } else {
          add(inner, h('div.grid.g3', field('Investment ledger', ledgerCombo(c, 'invest', s.inv, id => { s.inv = id; refresh(); })),
            field(s.kind === 'invest' ? 'Paid from' : 'Proceeds received in', ledgerCombo(c, 'money', s.money, id => { s.money = id; refresh(); })),
            field(s.kind === 'invest' ? 'Amount invested' : 'Sale proceeds', a)));
          if (s.kind === 'redeem') add(inner, h('div.grid.g3', field('Cost of what was sold', cost, 'blank = same as proceeds (no gain)'), field('Gain / loss ledger', ledgerCombo(c, 'income', s.gain || gainLedger(), id => { s.gain = id; refresh(); }))), h('p.small.muted', 'Lot-wise FIFO with automatic short/long-term classification arrives in Phase 2; for now enter the cost of the units sold.'));
        }
        refresh();
      };
      const gainLedger = () => { const g = c.ledgers.find(l => l.taxTag === 'capital_gain'); return g ? g.id : ''; };
      add(body, seg, h('div', { style: { height: '10px' } }), inner);
      draw();
      build = () => {
        const v = a.paise(); if (!v || !s.money) return null;
        if (s.kind === 'income') return s.income ? buildIncome(c, { date: st.date, incomeLedgerId: s.income, moneyLedgerId: s.money, gross: v, narration: st.narration, tags: tags() }) : null;
        if (!s.inv) return null;
        if (s.kind === 'redeem') {
          const gl = s.gain || gainLedger();
          const cp = cost.value.trim() ? cost.paise() : v;
          if (cp !== v && !gl) return null;
          return buildInvestment(c, { date: st.date, kind: 'redeem', investLedgerId: s.inv, moneyLedgerId: s.money, amount: v, cost: cp, gainLedgerId: gl, narration: st.narration, tags: tags() });
        }
        return buildInvestment(c, { date: st.date, kind: 'invest', investLedgerId: s.inv, moneyLedgerId: s.money, amount: v, narration: st.narration, tags: tags() });
      };
    },
    loan() {
      const s = { kind: 'repay', loan: '', money: defMoney, interest: '' };
      const pr = amountInput(0, { oninput: refresh }), it = amountInput(0, { oninput: refresh });
      const KINDS2 = [['repay', 'EMI / repayment paid'], ['borrow', 'Loan taken'], ['lend', 'Loan given'], ['recover', 'Repayment / interest received']];
      const seg = h('div.seg', KINDS2.map(([k, lbl]) => h('button', { class: k === s.kind ? 'on' : '', onclick: e => { s.kind = k; s.loan = ''; s.interest = ''; seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.target)); draw(); } }, lbl)));
      const inner = h('div');
      const draw = () => {
        clear(inner);
        const taken = s.kind === 'repay' || s.kind === 'borrow';
        const withInt = s.kind === 'repay' || s.kind === 'recover';
        if (!s.interest && withInt) s.interest = taken ? L('Home Loan Interest') || firstOf(l => c.natureOf(l) === 'finance') : L('Interest – Loans Given') || firstOf(l => c.rootOf(l) === 'income');
        add(inner, h('div.grid.g2', field(taken ? 'Loan (liability)' : 'Loan given (asset)', ledgerCombo(c, taken ? 'loanTaken' : 'loanGiven', s.loan, id => { s.loan = id; refresh(); })),
          field(s.kind === 'repay' || s.kind === 'lend' ? 'Paid from' : 'Received in', ledgerCombo(c, 'money', s.money, id => { s.money = id; refresh(); })),
          field('Principal', pr),
          withInt ? field('Interest', it, s.kind === 'repay' ? 'From the lender’s schedule; only interest is an expense' : 'Interest income received') : h('span'),
          withInt ? field('Interest ledger', ledgerCombo(c, taken ? 'expense' : 'income', s.interest, id => { s.interest = id; refresh(); })) : h('span')));
        refresh();
      };
      add(body, seg, h('div', { style: { height: '10px' } }), inner, h('p.small.muted', 'Money lent to Arihant Medicos is a loan given (asset); interest received is tagged as interest income.'));
      draw();
      build = () => {
        const p = pr.paise(), i = (s.kind === 'repay' || s.kind === 'recover') ? it.paise() : 0;
        if (!s.loan || !s.money || !(p + i)) return null;
        if (i && !s.interest) return null;
        return buildLoan(c, { date: st.date, kind: s.kind, loanLedgerId: s.loan, moneyLedgerId: s.money, interestLedgerId: s.interest, principal: p, interest: i, narration: st.narration, tags: tags() });
      };
    },
    daily() {
      const s = { inc: preset.incomeLedgerId || L('Clinic Receipts') || firstOf(l => l.taxTag === 'prof_receipts'), cash: L('Cash in Hand'), digital: defaultDigital(c) };
      const cash = amountInput(0, { oninput: refresh }), dig = amountInput(0, { oninput: refresh });
      const visits = h('input.inp', { type: 'number', min: 0, inputMode: 'numeric', placeholder: '0' });
      add(body, h('div.grid.g3', field('Income ledger', ledgerCombo(c, 'income', s.inc, id => { s.inc = id; setSiteFromLedger(id); refresh(); })), field('Cash collected', cash), field('UPI / card', dig),
        field('Patients seen', visits), field('Cash goes to', ledgerCombo(c, 'money', s.cash, id => { s.cash = id; refresh(); })), field('UPI / card settles to', ledgerCombo(c, 'money', s.digital, id => { s.digital = id; refresh(); }))),
        h('p.small.muted', 'Totals and patient count only — no patient names. For many days at once use Clinic & hospital daily.'));
      setSiteFromLedger(s.inc);
      build = () => (s.inc && (cash.paise() || dig.paise()) ? buildDailySummary(c, { date: st.date, siteId: st.siteId, incomeLedgerId: s.inc, cashLedgerId: s.cash, digitalLedgerId: s.digital, cash: cash.paise(), digital: dig.paise(), visits: Number(visits.value) || 0, narration: st.narration || 'Daily summary', tags: tags() }) : null);
    }
  };
  const titles = { income: 'Income (receipt)', expense: 'Expense (payment)', transfer: 'Transfer (contra)', investment: 'Investment', loan: 'Loan', daily: 'Clinic / hospital daily summary' };
  forms[kind]();
  add(body, h('div.grid.g4', { style: { marginTop: '10px' } }, field('Date', dateEl), h('div.span3', field('Narration', narrEl))),
    h('details', { style: { marginTop: '8px' } }, h('summary.small.muted', 'Site, owner and tags'), h('div.grid.g3', { style: { marginTop: '8px' } }, field('Site', siteSel), field('Owner', ownerSel), field('Custom tags', customInp))),
    h('div', { style: { marginTop: '10px' } }, previewEl));
  if (preset.siteId) { st.siteId = preset.siteId; siteSel.value = preset.siteId; }

  function refresh() {
    clear(previewEl);
    const d = safe(build);
    if (!d) { add(previewEl, h('span.muted', 'Fill the fields to see the double entry.')); return; }
    add(previewEl, linesPreview(c, d.lines));
  }
  async function save(again) {
    const d = safe(build);
    if (!d) { toast('Fill in the ledger and amount first'); return; }
    try {
      const v = await store.saveVoucher(newVoucher(entity.id, d));
      lastDate = st.date;
      toast('Saved ' + v.no, { label: 'View', fn: () => openVoucher(v.id) });
      md.close();
      if (again) openEntry(kind, { date: st.date });
    } catch (e) { toast(e.message); }
  }
  const md = openModal({
    title: titles[kind], size: 'wide', sticky: false,
    body,
    foot: [h('span.left.small.muted', 'Ctrl+Enter to save'), h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn', { onclick: () => save(true) }, 'Save & new'), h('button.btn.primary', { onclick: () => save(false) }, 'Save')]
  });
  md.el.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(false); } });
  refresh();
}
function safe(fn) { try { return fn(); } catch (e) { return null; } }
function defaultDigital(c) { const b = c.ledgers.find(l => !l.archived && c.natureOf(l) === 'bank'); return b ? b.id : ''; }
async function ensureGainLedger(c) {
  if (c.ledgers.some(l => l.taxTag === 'capital_gain')) return;
  const g = c.groups.find(x => x.key === 'othinc') || c.groups.find(x => x.root === 'income');
  if (g) await store.saveLedger(makeLedger({ entityId: c.entity.id, groupId: g.id, name: 'Capital Gains (unclassified)', taxTag: 'capital_gain', note: 'Phase 2 splits this into short / long term with FIFO lots.' }));
}

export function linesPreview(c, lines) {
  const dr = lines.filter(l => l.dr), cr = lines.filter(l => l.cr);
  const name = id => (c.lById.get(id) || {}).name || '?';
  return h('div', dr.map(l => h('div.ln', h('span', 'Dr ', h('b', name(l.ledgerId))), h('span.amt', money(l.dr)))),
    cr.map(l => h('div.ln', h('span.cr', 'Cr ', h('b', name(l.ledgerId))), h('span.amt', money(l.cr)))));
}

/* ---------- full voucher form (journal / pro mode, and editing any voucher) ---------- */
export function openJournal(entityId, draft = null, { existing = null, title = '', onCapture = null } = {}) {
  const c = store.ctxOf(entityId);
  const base = existing ? clone(existing) : null;
  const st = {
    type: (base || draft || {}).type || 'journal', date: (base || draft || {}).date || lastDate, narration: (base || draft || {}).narration || '',
    lines: ((base || draft || {}).lines || [{ ledgerId: '', dr: 0, cr: 0 }, { ledgerId: '', dr: 0, cr: 0 }]).map(l => ({ ...l })),
    tags: { siteId: '', owner: '', custom: [], ...((base || draft || {}).tags || {}) }, autoType: !base && !(draft && draft.type)
  };
  const entity = store.entityById(entityId);
  const tbody = h('tbody');
  const diffEl = h('div.diffbar');
  const typeSel = select(Object.entries(VTYPES).map(([k, t]) => ({ value: k, label: t.name + ' (' + t.key + ')' })), st.type, { onchange: e => { st.type = e.target.value; st.autoType = false; } });
  const draw = () => {
    clear(tbody);
    st.lines.forEach((ln, i) => {
      const dr = amountInput(ln.dr, { class: 'sm', oninput: () => { ln.dr = dr.paise(); if (ln.dr) { ln.cr = 0; cr.value = ''; } upd(); } });
      const cr = amountInput(ln.cr, { class: 'sm', oninput: () => { ln.cr = cr.paise(); if (ln.cr) { ln.dr = 0; dr.value = ''; } upd(); } });
      const cb = ledgerCombo(c, 'all', ln.ledgerId, id => { ln.ledgerId = id; upd(); }, { sm: true });
      add(tbody, h('tr', h('td', cb), h('td.r', dr), h('td.r', cr), h('td', h('button.btn.ghost.icon.sm', { title: 'Remove line', onclick: () => { st.lines.splice(i, 1); if (st.lines.length < 2) st.lines.push({ ledgerId: '', dr: 0, cr: 0 }); draw(); } }, '✕'))));
    });
    upd();
  };
  const upd = () => {
    const d = st.lines.reduce((t, l) => t + (l.dr || 0), 0), cr = st.lines.reduce((t, l) => t + (l.cr || 0), 0);
    add(clear(diffEl), h('span', 'Dr ', h('span.amt', money(d)), '   Cr ', h('span.amt', money(cr))),
      d === cr ? h('span.in', d ? '✓ Balanced' : '') : h('span.out', 'Difference ' + money(Math.abs(d - cr)) + (d > cr ? ' (needs Cr)' : ' (needs Dr)')));
    if (st.autoType) { st.type = inferType(c, st.lines.filter(l => l.ledgerId && (l.dr || l.cr))); typeSel.value = st.type; }
  };
  const balanceLast = () => {
    const d = st.lines.reduce((t, l) => t + (l.dr || 0), 0), cr = st.lines.reduce((t, l) => t + (l.cr || 0), 0);
    if (d === cr) return;
    st.lines.push({ ledgerId: '', dr: d < cr ? cr - d : 0, cr: d > cr ? d - cr : 0 }); draw();
  };
  const siteSel = select([{ value: '', label: '— no site —' }, ...(entity.sites || []).map(s => ({ value: s.id, label: s.name }))], st.tags.siteId, { onchange: e => { st.tags.siteId = e.target.value; } });
  const ownerSel = select([{ value: '', label: '— owner —' }, ...S.settings.owners.map(o => ({ value: o, label: o }))], st.tags.owner, { onchange: e => { st.tags.owner = e.target.value; } });
  const custom = h('input.inp', { value: (st.tags.custom || []).join(', '), onchange: e => { st.tags.custom = e.target.value.split(',').map(s => s.trim()).filter(Boolean); } });
  const body = h('div',
    h('div.grid.g4', field('Voucher type', typeSel), field('Date', dateInput(st.date, { onchange: e => { st.date = e.target.value; } })), h('div.span2', field('Narration', h('input.inp', { value: st.narration, oninput: e => { st.narration = e.target.value; } })))),
    h('div.tbl-wrap', { style: { marginTop: '10px' } }, h('table.lines', h('thead', h('tr', h('th', 'Ledger'), h('th.r', 'Debit'), h('th.r', 'Credit'), h('th'))), tbody)),
    diffEl,
    h('div.btnrow', h('button.btn.sm', { onclick: () => { st.lines.push({ ledgerId: '', dr: 0, cr: 0 }); draw(); } }, '+ Line'), h('button.btn.sm', { onclick: balanceLast }, 'Balance with new line')),
    h('div.grid.g3', { style: { marginTop: '10px' } }, field('Site', siteSel), field('Owner', ownerSel), field('Custom tags', custom)),
    base && base.meta && base.meta.visits ? h('p.small.muted', 'Patients: ' + base.meta.visits) : null);
  draw();
  const save = async () => {
    const lines = tidyLines(st.lines);
    const d = { type: st.type, date: st.date, narration: st.narration, lines, tags: st.tags };
    if (onCapture) {
      const dr = lines.reduce((t, l) => t + l.dr, 0), cr = lines.reduce((t, l) => t + l.cr, 0);
      if (lines.length < 2 || dr !== cr || !dr || lines.some(l => !c.lById.has(l.ledgerId))) { toast('The entry must balance and use valid ledgers'); return; }
      onCapture(d); md.close(); return;
    }
    try {
      let v;
      if (base) v = await store.saveVoucher({ ...base, ...d, src: base.src });
      else v = await store.saveVoucher(newVoucher(entityId, { ...d, src: (draft && draft.src) || 'journal', meta: (draft && draft.meta) || {} }));
      lastDate = st.date;
      toast((base ? 'Updated ' : 'Saved ') + v.no);
      md.close();
    } catch (e) { toast(e.message); }
  };
  const md = openModal({
    title: title || (base ? 'Edit ' + (base.no || 'voucher') : 'Voucher'), size: 'wide', body,
    foot: [base ? h('button.btn.danger.left', { onclick: async () => { if (await confirmBox('Delete this voucher?', 'It is removed from the books; the audit trail keeps a copy.', 'Delete', true)) { try { await store.deleteVoucher(base.id); md.close(); toast('Deleted'); } catch (e) { toast(e.message); } } } }, 'Delete') : h('span.left.small.muted', 'Ctrl+Enter to save'),
      h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: save }, onCapture ? 'Use this entry' : base ? 'Save changes' : 'Save')]
  });
  md.el.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });
}

/* ---------- voucher view (drill-down target) ---------- */
export async function openVoucher(id) {
  const v = store.voucher(id); if (!v) { toast('Voucher not found'); return; }
  const c = store.ctxOf(v.entityId);
  const entity = store.entityById(v.entityId);
  const locked = entity.lockedUpto && v.date <= entity.lockedUpto;
  const site = (entity.sites || []).find(s => s.id === (v.tags || {}).siteId);
  const hist = (await store.listAudit()).filter(a => a.refId === id);
  const rows = v.lines.map(l => { const led = c.lById.get(l.ledgerId); return h('tr.click', { onclick: () => { md.close(); location.hash = '#/ledger/' + l.ledgerId; } }, h('td', led ? led.name : '(missing ledger)', l.note ? h('div.narr', l.note) : null), h('td.r.amt', l.dr ? money(l.dr) : ''), h('td.r.amt', l.cr ? money(l.cr) : '')); });
  const tot = v.lines.reduce((t, l) => t + (l.dr || 0), 0);
  const meta = [];
  if (v.meta && v.meta.visits) meta.push('Patients: ' + v.meta.visits);
  if (v.meta && v.meta.mode) meta.push('Mode: ' + v.meta.mode);
  if (v.meta && v.meta.bankNarration && v.meta.bankNarration !== v.narration) meta.push('Bank: ' + v.meta.bankNarration);
  if (v.batchId) meta.push('Imported (batch)');
  if (v.recurringId) meta.push('From recurring entry');
  const md = openModal({
    title: (VTYPES[v.type] || {}).name + ' ' + (v.no || ''), sub: fmtDate(v.date) + ' · ' + entity.name + (locked ? ' · 🔒 locked' : ''), size: 'wide',
    body: h('div', v.narration ? h('p', { style: { marginTop: 0 } }, v.narration) : null,
      h('table.tbl', h('thead', h('tr', h('th', 'Ledger'), h('th.r', 'Debit'), h('th.r', 'Credit'))), h('tbody', rows), h('tfoot', h('tr', h('td', 'Total'), h('td.r.amt', money(tot)), h('td.r.amt', money(tot))))),
      h('div.btnrow', { style: { marginTop: '8px' } }, site ? h('span.pill.gold', site.name) : null, v.tags && v.tags.owner ? h('span.pill', v.tags.owner) : null, ...(v.tags && v.tags.custom || []).map(t => h('span.pill', '#' + t)), ...meta.map(m => h('span.pill', m))),
      hist.length ? h('details', { style: { marginTop: '10px' } }, h('summary.small.muted', 'History (' + hist.length + ')'), h('ul.small', hist.map(a => h('li', fmtDate(a.at.slice(0, 10)) + ' ' + a.at.slice(11, 16) + ' — ' + a.action + (a.before && a.after ? diffText(a.before, a.after) : ''))))) : null),
    foot: [h('button.btn.left', { onclick: () => { md.close(); saveShortcut(v); } }, '★ Save as shortcut'),
      h('button.btn', { onclick: () => { md.close(); const d = clone(v); openJournal(v.entityId, { type: d.type, date: today(), narration: d.narration, lines: d.lines, tags: d.tags, src: d.src, meta: d.meta }, { title: 'Duplicate' }); } }, 'Duplicate'),
      h('button.btn.primary', { disabled: locked, onclick: () => { md.close(); openJournal(v.entityId, null, { existing: v }); } }, locked ? 'Locked' : 'Edit')]
  });
}
function diffText(a, b) {
  const out = [];
  if (a.date !== b.date) out.push('date ' + a.date + '→' + b.date);
  const ta = a.lines.reduce((t, l) => t + l.dr, 0), tb = b.lines.reduce((t, l) => t + l.dr, 0);
  if (ta !== tb) out.push('amount ' + formatINR(ta) + '→' + formatINR(tb));
  if (a.narration !== b.narration) out.push('narration');
  if (JSON.stringify(a.lines.map(l => l.ledgerId)) !== JSON.stringify(b.lines.map(l => l.ledgerId))) out.push('ledgers');
  return out.length ? ': ' + out.join(', ') : '';
}
async function saveShortcut(v) {
  const { promptBox } = await import('../ui/widgets.js');
  const name = await promptBox('Save as shortcut', 'Shortcut name', v.narration || 'Shortcut');
  if (!name) return;
  const { uid, nowISO } = await import('../lib/util.js');
  await store.commit([{ store: 'shortcuts', put: { id: uid('sc'), entityId: v.entityId, name, template: { type: v.type, src: v.src, narration: v.narration, lines: v.lines, tags: v.tags }, createdAt: nowISO() } }]);
  toast('Shortcut saved — find it under Add entry');
}

/* ---------- Clinic & hospital daily: fast grid for many days ---------- */
export function renderDaily(root) {
  const entity = store.activeEntity();
  const c = store.ctx();
  const incomes = c.ledgers.filter(l => !l.archived && l.taxTag === 'prof_receipts');
  if (!incomes.length) { add(root, h('div.empty', 'No professional-receipts ledger in this entity. Add one under Ledgers.')); return; }
  const st = { inc: (incomes.find(l => l.name === 'Clinic Receipts') || incomes[0]).id, cash: (c.ledgers.find(l => c.natureOf(l) === 'cash') || {}).id, digital: defaultDigital(c), days: 7, end: today() };
  const grid = h('div');
  const head = h('div.card', h('div.card-b', { style: { paddingTop: '12px' } }, h('div.grid.g4',
    field('Income ledger', ledgerCombo(c, l => l.taxTag === 'prof_receipts', st.inc, id => { st.inc = id; draw(); })),
    field('Cash goes to', ledgerCombo(c, 'money', st.cash, id => { st.cash = id; })),
    field('UPI / card settles to', ledgerCombo(c, 'money', st.digital, id => { st.digital = id; })),
    field('Days up to', dateInput(st.end, { onchange: e => { st.end = e.target.value; draw(); } })))));
  add(root, h('p.muted', { style: { marginTop: 0 } }, 'One row per day: cash, UPI/card and patient count — split into accounts automatically. Days already entered for this ledger are shown and skipped.'), head, h('div', { style: { height: '12px' } }), grid);
  function draw() {
    clear(grid);
    const existing = new Map();
    for (const v of c.vouchers) if (v.src === 'daily' && v.lines.some(l => l.ledgerId === st.inc && l.cr)) existing.set(v.date, v);
    const rows = [];
    const tb = h('tbody');
    for (let i = st.days - 1; i >= 0; i--) {
      const d = addDays(st.end, -i);
      const ex = existing.get(d);
      if (ex) { add(tb, h('tr', h('td', fmtDate(d)), h('td.r.amt', money(ex.meta.cash || 0)), h('td.r.amt', money(ex.meta.digital || 0)), h('td.r', String(ex.meta.visits || 0)), h('td', h('button.btn.sm', { onclick: () => openVoucher(ex.id) }, 'Entered ' + ex.no)))); continue; }
      const r = { date: d, cash: amountInput(0, { class: 'sm' }), dig: amountInput(0, { class: 'sm' }), vis: h('input.inp.sm', { type: 'number', min: 0, inputMode: 'numeric', style: { width: '80px' } }) };
      rows.push(r);
      add(tb, h('tr', h('td', fmtDate(d), h('span.muted.small', ' ' + new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }))), h('td.r', r.cash), h('td.r', r.dig), h('td.r', r.vis), h('td')));
    }
    const save = async () => {
      const list = [];
      for (const r of rows) {
        const cash = r.cash.paise(), dig = r.dig.paise();
        if (!cash && !dig) continue;
        list.push(newVoucher(entity.id, buildDailySummary(c, { date: r.date, siteId: (c.lById.get(st.inc) || {}).siteId || '', incomeLedgerId: st.inc, cashLedgerId: st.cash, digitalLedgerId: st.digital, cash, digital: dig, visits: Number(r.vis.value) || 0, narration: 'Daily summary' })));
      }
      if (!list.length) { toast('Nothing to save'); return; }
      try { await store.saveVouchers(list); toast(list.length + ' day(s) saved'); } catch (e) { toast(e.message); }
    };
    add(grid, h('div.card', h('div.card-b', { style: { paddingTop: '10px' } },
      h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Date'), h('th.r', 'Cash'), h('th.r', 'UPI / card'), h('th.r', 'Patients'), h('th'))), tb)),
      h('div.btnrow', { style: { marginTop: '10px' } }, select([7, 14, 31].map(n => ({ value: n, label: n + ' days' })), st.days, { class: 'inp sm', style: { width: 'auto' }, onchange: e => { st.days = Number(e.target.value); draw(); } }), h('span.spacer'), h('button.btn.primary', { onclick: save }, 'Save all days')))));
  }
  draw();
}
