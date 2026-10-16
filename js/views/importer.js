/* Import hub. Every import goes through a review screen; nothing posts until approved, and each
   import is one batch that can be undone. */
import { h, clear, money, amt, drcr, pickFile, add } from '../ui/dom.js';
import { openModal, toast, confirmBox, select, field, combo, dateInput, amountInput } from '../ui/widgets.js';
import { ledgerItems, ledgerCombo } from '../ui/pickers.js';
import * as store from '../app/store.js';
import { S } from '../app/store.js';
import { parseCSV, parseTableStatement, groupPdfItems, parsePdfStatement, BANK_NAMES } from '../import/statement-parse.js';
import { planRows, rowToVoucher, makeBatch, ruleMatch, suggestKeyword, matchLoanLedger, loanSectionVouchers, relinkAsTransfer } from '../import/statement-plan.js';
import { parseTaxPnl, parseHoldings, parseTradewise, parseConsolePnl, parseDpHoldings, holdingKey } from '../import/zerodha.js';
import { planZerodhaPnl, buildZerodhaPostings } from '../import/zerodha-plan.js';
import { ASSET_TYPES } from '../core/invest.js';
import { readWorkbook, readPdfItems } from '../import/libs.js';
import { balances, ledgerStatement, makeCtx } from '../core/books.js';
import { LEGACY_KEY, looksLegacy, buildLegacyPlan, suggestMapping, normalizeLegacy, ownerOfAccount } from '../core/legacy.js';
import { fmtDate, today, fyOf, fyList, fyRange, parseDateAny } from '../lib/dates.js';
import { uid, nowISO, normNarr } from '../lib/util.js';
import { toPaise } from '../lib/money.js';
import { valueAsset } from '../core/invest.js';
import { newVoucher, tidyLines, validateVoucher, nextNumber } from '../core/vouchers.js';
import { BROKER_WORDS, MF_WORDS, makeLedger } from '../core/masters.js';
import { addDays } from '../lib/dates.js';

export function renderImport(root) {
  const e = store.activeEntity();
  const tile = (icon, title, sub, fn) => h('button.card', { style: { textAlign: 'left', padding: '14px', cursor: 'pointer', border: '1px solid var(--line)' }, onclick: fn }, h('div', { style: { fontSize: '20px' } }, icon), h('b', title), h('div.small.muted', sub));
  add(root, h('p.muted', { style: { marginTop: 0 } }, 'Into: ', h('b', e.name), '. Files are read on this device — nothing is uploaded.'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '12px' } },
      tile('🏦', 'Bank statement', 'PDF (password OK), CSV, XLS, XLSX · SBI, BoB, HDFC, IDFC tuned + generic columns', () => importStatement()),
      tile('⇪', 'Old DoctorWealth data', 'Bring across accounts, income, expenses, loans and investments — every balance is checked', () => importLegacy()),
      tile('📈', 'Zerodha P&L', 'Tax P&L (taxpnl-….xlsx) or Console P&L — adds your sales, profits and F&O results', () => importZerodhaPnl()),
      tile('📊', 'Zerodha holdings', 'Kite holdings Excel, or the DP holding statement PDF — adds shares to Portfolio and updates prices', () => importHoldings()),
      tile('↺', 'Restore backup', 'A backup file from this app (replaces everything)', () => restoreBackup())));
  add(root, h('div.section-h', h('h2', 'Rules'), h('span.muted.small', 'a word in the bank description → category (you still check every row)'), h('span.spacer'), h('button.btn.sm', { onclick: () => editRule(null) }, '+ Rule')));
  const rules = S.rules.filter(r => r.entityId === e.id);
  add(root, h('div.card', rules.length ? h('table.tbl', h('tbody', rules.map(r => h('tr.click', { onclick: () => editRule(r) }, h('td', '“' + r.pattern + '”'), h('td', (store.ledger(r.ledgerId) || {}).name || '(deleted)'), h('td.small.muted', r.dir === 'debit' ? 'money out' : r.dir === 'credit' ? 'money in' : 'either'), h('td.r', r.off ? h('span.pill', 'off') : '')))))
    : h('div.empty', 'No rules yet. Create them from the ★ button while reviewing a statement.')));
  const batches = S.batches.filter(b => b.entityId === e.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  add(root, h('div.section-h', h('h2', 'Import history')), h('div.card', batches.length ? h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'When'), h('th', 'What'), h('th.r', 'Entries'), h('th'))),
    h('tbody', batches.map(b => h('tr', h('td.nowrap', fmtDate(b.createdAt.slice(0, 10))), h('td', batchLabel(b), h('div.narr', b.file || '')), h('td.r', String(S.vouchers.filter(v => v.batchId === b.id).length)), h('td.r', h('button.btn.sm.danger', { onclick: () => undoBatch(b) }, 'Undo')))))))
    : h('div.empty', 'Imports appear here with one-tap undo.')));
  const tp = S.taxpnl.filter(t => t.entityId === e.id), hl = S.holdings.filter(x => x.entityId === e.id);
  if (tp.length || hl.length) {
    add(root, h('div.section-h', h('h2', 'Saved broker data'), h('span.muted.small', 'used by Investments (Phase 2) and the Tax engine (Phase 3)')));
    if (tp.length) add(root, h('div.card', { style: { marginBottom: '12px' } }, h('div.card-h', h('h3', 'Tax P&L')), h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'FY'), h('th.r', 'STCG'), h('th.r', 'LTCG'), h('th.r', 'Intraday'), h('th.r', 'F&O'), h('th.r', 'Dividends'), h('th'))),
      h('tbody', tp.sort((a, b) => b.fy.localeCompare(a.fy)).map(t => h('tr', h('td', t.fy), h('td.r.amt', money(t.stcg)), h('td.r.amt', money(t.ltcg)), h('td.r.amt', money(t.intraday)), h('td.r.amt', money(t.foOptions + t.foFutures)), h('td.r.amt', money(t.dividends)),
        h('td.r', h('button.btn.sm.ghost', { onclick: async () => { if (await confirmBox('Remove this tax P&L?', t.fy + ' · ' + (t.file || ''), 'Remove', true)) store.commit([{ store: 'taxpnl', del: t.id }]); } }, '✕')))))))));
    if (hl.length) {
      const c = store.ctx(); const bal = balances(c);
      const byLedger = new Map(); for (const x of hl) byLedger.set(x.ledgerId, (byLedger.get(x.ledgerId) || 0) + x.cost);
      add(root, h('div.card', h('div.card-h', h('h3', 'Holdings snapshot'), h('span.sub', hl.length + ' items · cost ' + money(hl.reduce((t, x) => t + x.cost, 0)) + ' · value ' + money(hl.reduce((t, x) => t + x.value, 0)))),
        h('div.card-b', [...byLedger].map(([lid, cost]) => { const l = c.lById.get(lid); const b2 = l ? bal.get(lid).closing : 0; return h('div.stmt-row', h('span', (l ? l.name : 'Unassigned') + ' — holdings at cost ' + money(cost)), h('span', l ? (b2 === cost ? h('span.in', '✓ matches books') : h('span.warn-t', 'books ' + money(b2) + ' · diff ' + money(cost - b2))) : '')); }),
          h('div.btnrow', { style: { marginTop: '8px' } }, h('button.btn.sm.danger', { onclick: async () => { if (await confirmBox('Clear holdings snapshot?', 'Only the snapshot is removed; books are not affected.', 'Clear', true)) store.commit(hl.map(x => ({ store: 'holdings', del: x.id }))); } }, 'Clear snapshot')))));
    }
  }
}
function batchLabel(b) {
  if (b.kind === 'statement') return 'Bank statement → ' + ((store.ledger(b.ledgerId) || {}).name || '?') + ' · ' + (BANK_NAMES[b.bank] || b.bank || '') + (b.from ? ' · ' + fmtDate(b.from) + ' – ' + fmtDate(b.to) : '');
  if (b.kind === 'legacy') return 'Old DoctorWealth data';
  if (b.kind === 'zerodha_pnl') return 'Zerodha P&L · ' + (b.count || 0) + ' entries';
  return b.kind;
}

/* ================= bank statement ================= */
const pwKey = id => 'dwb_pw_' + id;
const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* storage blocked */ } };

export function importStatement(presetLedgerId, carry = {}) {
  const entity = store.activeEntity();
  const c = store.ctxOf(entity.id);
  const st = { ledgerId: carry.ledgerId || presetLedgerId || '', bank: carry.bank || 'auto', file: carry.file || null };
  const fileBtn = h('button.btn', { style: { width: '100%' } }, st.file ? '📄 ' + st.file.name : 'Choose statement file…');
  const pw = h('input.inp', { type: 'password', autocomplete: 'off', placeholder: 'Often DOB / customer-ID based — see the bank’s email', value: carry.pw || '' });
  const rem = h('input', { type: 'checkbox' });
  const pwWrap = h('div.grid', field('PDF password (if protected)', pw), h('label.check.small', rem, h('span', 'Remember for this account ', h('b', 'on this device'), h('div.muted', 'Stored unencrypted in this browser only (never exported or synced).'))));
  const syncPw = () => { const saved = lsGet(pwKey(st.ledgerId)); if (saved && !carry.pw) { pw.value = saved; rem.checked = true; } };
  const showPw = () => pwWrap.classList.toggle('hide', !(st.file && /\.pdf$/i.test(st.file.name)));
  fileBtn.addEventListener('click', async () => { const f = await pickFile('.pdf,.csv,.txt,.xls,.xlsx,application/pdf,text/csv'); if (f) { st.file = f; fileBtn.textContent = '📄 ' + f.name; showPw(); } });
  const lc = ledgerCombo(c, 'pay', st.ledgerId, id => { st.ledgerId = id; syncPw(); });
  syncPw(); showPw();
  const bankSel = select(Object.entries(BANK_NAMES).map(([k, v]) => ({ value: k, label: v })), st.bank, { onchange: e => { st.bank = e.target.value; } });
  const md = openModal({
    title: 'Import bank statement', sub: 'You will review and edit every row before anything is saved.',
    body: h('div.grid', carry.error ? h('div.note.warn', carry.error) : null, field('Which bank account / card is this statement for?', lc), field('Bank format', bankSel), fileBtn, pwWrap),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: go }, 'Read statement')]
  });
  if (carry.pwFocus) setTimeout(() => pw.focus(), 60);
  async function go() {
    if (!st.ledgerId) return toast('Choose the account first');
    if (!st.file) return toast('Choose a file');
    lsSet(pwKey(st.ledgerId), rem.checked ? pw.value : '');
    md.close();
    const busy = openModal({ title: 'Reading ' + st.file.name + '…', body: h('p.muted', 'Working on this device — nothing is uploaded.') });
    const ctxArgs = { ledgerId: st.ledgerId, bank: st.bank, file: st.file, pw: pw.value };
    let res;
    try {
      const name = st.file.name;
      if (/\.pdf$/i.test(name)) res = parsePdfStatement((await readPdfItems(await st.file.arrayBuffer(), pw.value)).map(groupPdfItems));
      else if (/\.(csv|txt)$/i.test(name)) res = parseTableStatement(parseCSV(await st.file.text()));
      else {
        const sheets = await readWorkbook(await st.file.arrayBuffer());
        let best = null;
        for (const rows of Object.values(sheets)) { const r = parseTableStatement(rows); if (!r.error && (!best || best.error || r.txns.length > best.txns.length)) best = r; else if (!best) best = r; }
        res = best || { error: 'Empty workbook' };
      }
    } catch (err) {
      busy.close();
      if (err.code === 'PASSWORD_NEEDED' || err.code === 'PASSWORD_WRONG') return importStatement(presetLedgerId, { ...ctxArgs, error: err.message, pwFocus: true, pw: '' });
      return importStatement(presetLedgerId, { ...ctxArgs, error: err.message });
    }
    busy.close();
    if (res.error) return importStatement(presetLedgerId, { ...ctxArgs, error: res.error });
    if (st.bank !== 'auto') res.bank = st.bank;
    reviewStatement(ctxArgs, res);
  }
}

function reviewStatement(args, res) {
  const entity = store.activeEntity();
  const c = store.ctxOf(entity.id);
  const L = c.lById.get(args.ledgerId);
  const suspense = c.ledgers.find(l => l.system === 'suspense');
  const rules = S.rules.filter(r => r.entityId === entity.id && !r.off);
  /* broker / wallet transfers and mutual-fund payments are recognised so they are not booked as spending */
  const brokerLedger = key => c.ledgers.find(l => !l.archived && l.broker === key && c.natureOf(l) === 'wallet');
  const mfLedger = c.ledgers.find(l => !l.archived && l.name === 'Mutual Funds');
  const autoMap = (narr, dir) => {
    for (const [re, key] of BROKER_WORDS) if (re.test(narr)) { const w = brokerLedger(key); if (w) return { ledgerId: w.id, hint: 'wallet' }; }
    if (dir === 'debit' && MF_WORDS.test(narr) && mfLedger) return { ledgerId: mfLedger.id, hint: 'invest' };
    return null;
  };
  const rows = planRows(c, args.ledgerId, res, rules, suspense ? suspense.id : '', autoMap);
  const items = ledgerItems(c, l => l.id !== args.ledgerId);
  /* loan accounts printed in the same PDF (Bank of Baroda e-statement) */
  const finItems = ledgerItems(c, l => c.rootOf(l) === 'expense');
  const homeInt = c.ledgers.find(l => !l.archived && l.taxTag === 'home_loan_interest');
  const charges = c.ledgers.find(l => !l.archived && /bank.*charges/i.test(l.name) && c.rootOf(l) === 'expense');
  const loanPlans = (res.loans || []).map((sec, i) => {
    const m = matchLoanLedger(c, sec);
    const long = sec.detail && sec.detail.tenure >= 120;
    return { i, sec, ledgerId: m ? m.id : '', create: !m, interestId: (long && homeInt) ? homeInt.id : '', post: true, matchOpening: true };
  });
  const loanRef = id => (loanPlans.find(pl => 'newloan:' + pl.i === id) || null);
  for (const r of rows) for (const pl of loanPlans) {
    if (r.dir === 'debit' && pl.sec.acct && r.narration.replace(/\s/g, '').includes(pl.sec.acct)) { r.counterId = pl.ledgerId || 'newloan:' + pl.i; r.loanPlan = pl.i; r.hint = 'loan'; delete r.pair; }
  }
  const loanName = pl => (BANK_NAMES[res.bank] && res.bank !== 'generic' ? BANK_NAMES[res.bank] + ' loan …' : 'Loan …') + String(pl.sec.acct).slice(-4);
  const loanBox = h('div');
  function drawLoans() {
    clear(loanBox);
    if (!loanPlans.length) return;
    add(loanBox, h('div.card', { style: { margin: '10px 0', padding: '10px 12px' } }, h('b', '⚖ Loan accounts in this statement'),
      h('div.small.muted', 'The bank’s own loan pages: interest it charged and what you owe. EMIs from this account go to the loan; the interest is added so the loan matches the bank exactly.'),
      loanPlans.map(pl => {
        const sc = pl.sec, d = sc.detail || {};
        const loanSel = combo([{ id: '', label: '+ Create “' + loanName(pl) + '”', group: '' }, ...ledgerItems(c, 'loanTaken')], pl.ledgerId, id => {
          pl.ledgerId = id; pl.create = !id;
          for (const r of rows) if (r.loanPlan === pl.i) r.counterId = id || 'newloan:' + pl.i;
          draw();
        }, { sm: true });
        const intSel = combo([{ id: '', label: '+ Create “Loan Interest”', group: '' }, ...finItems], pl.interestId, id => { pl.interestId = id; }, { sm: true });
        const ints = sc.txns.filter(t => t.debit).length;
        return h('div', { style: { borderTop: '1px solid var(--line)', marginTop: '8px', paddingTop: '8px' } },
          h('div', 'A/c …' + String(sc.acct).slice(-6) + ' · bank says you owe ', h('b', money(Math.abs(sc.closing || 0))), ' on ' + fmtDate(sc.to),
            h('span.small.muted', ' · interest charged ' + money(sc.totalDebit) + ' · paid ' + money(sc.totalCredit) + (d.emi ? ' · EMI ' + money(d.emi) : '') + (d.rate ? ' · ' + d.rate + '%' : ''))),
          h('div.grid.g2', { style: { marginTop: '6px' } }, field('This loan is', loanSel), field('Interest goes to', intSel)),
          h('label.check.small', h('input', { type: 'checkbox', checked: pl.post, onchange: e => { pl.post = e.target.checked; } }), h('span', 'Add the bank’s ' + ints + ' interest / charge entr' + (ints === 1 ? 'y' : 'ies') + ' to this loan')),
          h('label.check.small', h('input', { type: 'checkbox', checked: pl.matchOpening, onchange: e => { pl.matchOpening = e.target.checked; } }), h('span', 'Set the loan’s starting balance so it matches the bank (owed ' + money(Math.abs(sc.opening || 0)) + ' on ' + fmtDate(sc.from) + ')')));
      })));
  }
  const before = ledgerStatement(c, args.ledgerId, { to: res.to }).closing;
  const adj = { on: false, amount: 0 };
  let filter = '', shown = 200;
  const sum = h('div');
  const tbody = h('tbody');
  const more = h('button.btn.sm', { onclick: () => { shown += 200; draw(); } }, 'Show more');
  const adjChk = h('input', { type: 'checkbox', onchange: e => { adj.on = e.target.checked; upd(); } });
  const adjTxt = h('span');
  const adjWrap = h('label.check.small', adjChk, adjTxt);
  const bulkSel = combo(items, '', id => { if (!id) return; let n = 0; for (const r of rows) if (r.sel) { r.counterId = id; n++; } toast(n ? 'Category set on ' + n + ' row(s)' : 'Tick rows in the ☐ column first'); bulkSel.set(''); draw(); }, { sm: true, placeholder: 'Set category for ticked rows…' });
  const body = h('div',
    h('p.small.muted', { style: { marginTop: 0 } }, args.file.name + ' · ' + (BANK_NAMES[res.bank] || res.bank) + ' · ' + rows.length + ' rows · ' + fmtDate(res.from) + ' → ' + fmtDate(res.to)),
    sum,
    loanBox,
    res.guesses ? h('div.note.warn', { style: { margin: '8px 0' } }, res.guesses + ' row(s): could not be sure if money came in or went out — check rows marked ⚠ (use ⇅ to flip).') : null,
    h('div.toolbar', { style: { margin: '10px 0 8px' } },
      h('button.btn.sm', { onclick: () => { for (const r of visible()) r.sel = true; draw(); } }, 'Select all shown'),
      h('button.btn.sm', { onclick: () => { for (const r of rows) r.sel = false; draw(); } }, 'Select none'),
      h('button.btn.sm', { onclick: () => { let n = 0; for (const r of rows) if (r.sel) { r.include = false; n++; } toast(n + ' excluded'); draw(); } }, 'Exclude selected'),
      h('div', { style: { width: '240px' } }, bulkSel),
      h('input.inp.sm', { placeholder: 'Filter rows…', style: { width: '200px' }, oninput: e => { filter = normNarr(e.target.value); draw(); } })),
    h('div.tbl-wrap', { style: { maxHeight: '52vh', overflowY: 'auto' } }, h('table.tbl.rev-tbl', h('thead', h('tr', h('th', '✓'), h('th', '☐'), h('th', 'Date'), h('th', 'Bank description'), h('th.r', 'Out'), h('th.r', 'In'), h('th', 'Category / where it went'), h('th'))), tbody)),
    more, h('div', { style: { marginTop: '8px' } }, adjWrap));
  function visible() { return filter ? rows.filter(r => normNarr(r.narration + ' ' + r.note).includes(filter)) : rows; }
  function draw() {
    clear(tbody);
    const vr = visible();
    for (const r of vr.slice(0, shown)) add(tbody, rowEl(r));
    more.classList.toggle('hide', vr.length <= shown);
    upd();
  }
  function rowEl(r) {
    const tr = h('tr', { class: (r.include ? '' : 'off ') + (r.dup || r.soft ? 'dup' : '') });
    const inc = h('input', { type: 'checkbox', checked: r.include, title: 'Import this row', onchange: e => { r.include = e.target.checked; tr.classList.toggle('off', !r.include); upd(); } });
    const sel = h('input', { type: 'checkbox', checked: !!r.sel, title: 'Select for bulk actions', onchange: e => { r.sel = e.target.checked; } });
    const cb = combo(items, r.counterId, id => { r.counterId = id; upd(); }, { sm: true });
    const note = h('input.inp.sm', { value: r.note, oninput: e => { r.note = e.target.value; }, title: 'Note saved with the entry' });
    const flags = [];
    if (r.check === 'guess' || r.check === 'mismatch') flags.push(h('span.pill.warn', { title: 'Not sure if money came in or went out' }, '⚠'));
    if (r.rule) flags.push(h('span.pill.gold', { title: 'Matched rule' }, '★ ' + r.rule));
    if (r.hint === 'wallet') flags.push(h('span.pill', { title: 'Moving your own money to a broker / wallet — not spending, not yet an investment' }, '⇄ to wallet'));
    if (r.hint === 'own' && r.pair && r.counterId === r.pair.moneyId) flags.push(h('span.pill.ok', { title: 'Same UPI / UTR reference as an entry already imported from ' + ((c.lById.get(r.pair.moneyId) || {}).name || 'another account') + ' on ' + fmtDate(r.pair.voucher.date) + '. That entry becomes one transfer between your accounts; nothing is added twice.' }, '⇄ own transfer · ' + ((c.lById.get(r.pair.moneyId) || {}).name || '')));
    if (r.hint === 'loan') { const pl = loanPlans[r.loanPlan]; flags.push(h('span.pill.gold', { title: 'EMI for the loan account in this statement' }, '⚖ EMI → ' + (pl && pl.create ? 'new ' + loanName(pl) : ((c.lById.get(r.counterId) || {}).name || 'loan')))); }
    if (r.hint === 'invest') flags.push(h('span.pill', { title: 'Looks like a mutual fund purchase — link it to the fund in Portfolio afterwards (no second entry needed)' }, '◆ investment'));
    if (r.dup) flags.push(h('span.pill.warn', { title: r.dup.voucher ? 'Already recorded on ' + fmtDate(r.dup.voucher.date) : 'Same as row #' + r.dup.row }, '⧉ duplicate'));
    else if (r.soft) flags.push(h('span.pill.warn', { title: 'A similar entry already exists on ' + fmtDate(r.soft.voucher.date) + ' ' + (r.soft.voucher.narration || '') }, '≈ possible duplicate'));
    const flip = h('button.btn.ghost.sm', { title: 'Flip money in / out', onclick: () => { r.dir = r.dir === 'debit' ? 'credit' : 'debit'; r.check = 'flipped'; draw(); } }, '⇅');
    const star = h('button.btn.ghost.sm', { title: 'Make a rule from this row', onclick: () => editRule(null, { pattern: suggestKeyword(r.narration), ledgerId: r.counterId, dir: r.dir }, rule => {
      let n = 0; for (const x of rows) { const m = ruleMatch([rule], x.narration, x.dir); if (m) { x.counterId = rule.ledgerId; x.rule = rule.pattern; n++; } }
      toast('Rule applied to ' + n + ' row(s)'); draw();
    }) }, '★');
    add(tr, h('td', inc), h('td', sel), h('td.nowrap', fmtDate(r.date)), h('td.narr', h('div', r.narration), note, h('div.btnrow', { style: { gap: '4px', marginTop: '3px' } }, flags)),
      h('td.r.amt.out', r.dir === 'debit' ? money(r.amount) : ''), h('td.r.amt.in', r.dir === 'credit' ? money(r.amount) : ''), h('td', { style: { minWidth: '210px' } }, cb), h('td.nowrap', flip, star));
    return tr;
  }
  function upd() {
    let n = 0, dr = 0, cr = 0, dupN = 0, delta = 0, susp = 0, missing = 0;
    for (const r of rows) {
      if (r.dup) dupN++;
      if (!r.include) continue;
      n++;
      if (r.dir === 'debit') dr += r.amount; else cr += r.amount;
      if (r.date <= res.to) delta += r.dir === 'debit' ? -r.amount : r.amount;
      if (suspense && r.counterId === suspense.id) susp++;
      if (!r.counterId) missing++;
    }
    const after = before + delta + (adj.on ? adj.amount : 0);
    add(clear(sum), h('div.rev-sum',
      kpiBox('Importing', n + ' of ' + rows.length, dupN ? dupN + ' duplicate(s) unticked' : 'no duplicates'),
      kpiBox('Money out / in', h('span', h('span.out', '−' + money(dr)), ' / ', h('span.in', '+' + money(cr)))),
      kpiBox('Statement adds up?', res.arith === null ? 'n/a' : res.arith === 0 ? h('span.in', '✓ yes') : h('span.out', 'off ' + money(Math.abs(res.arith))), 'start + in − out = end'),
      kpiBox('Matches bank balance?', res.closing == null ? 'n/a' : after === res.closing ? h('span.in', '✓ yes') : h('span.out', 'off ' + money(Math.abs(after - res.closing))), res.closing == null ? 'no closing balance in file' : 'app ' + money(after) + ' vs bank ' + money(res.closing))),
      susp ? h('div.note.warn', susp + ' row(s) have no category yet and will go to “To sort later” — fine for now, you can sort them any time.') : null,
      missing ? h('div.note.bad', missing + ' row(s) have no category.') : null);
    if (res.closing != null) {
      const base = before + delta - res.closing;
      if (!adj.on) adj.amount = -base;
      adjWrap.classList.toggle('hide', base === 0 && !adj.on);
      add(clear(adjTxt), 'Also adjust ', h('b', L.name), '’s starting balance by ', h('b', money(adj.amount, { sign: true })), ' so it matches the bank ', h('span.muted', '(use this when the app did not have this account’s earlier history)'));
    } else adjWrap.classList.add('hide');
    okBtn.textContent = 'Approve & post (' + n + ')';
  }
  const okBtn = h('button.btn.primary', { onclick: commit });
  const md = openModal({
    title: 'Review statement — ' + L.name, size: 'xwide', sticky: true, body,
    foot: [h('span.left.small.muted', 'Nothing is saved until you approve.'), h('button.btn', { onclick: () => md.close() }, 'Cancel'), okBtn]
  });
  draw();
  async function commit() {
    const keep = rows.filter(r => r.include);
    if (!keep.length) return toast('Nothing selected to import');
    const bad = keep.find(r => !r.counterId || !r.amount || !r.date);
    if (bad) return toast('Row dated ' + fmtDate(bad.date) + ' needs a category / amount / date');
    const batch = makeBatch(c, { kind: 'statement', ledgerId: args.ledgerId, file: args.file.name, bank: res.bank, from: res.from, to: res.to, count: keep.length, opening: res.opening, closing: res.closing, openingAdj: adj.on ? adj.amount : 0 });
    /* loan accounts first: create the ones asked for, line their starting balance up with the bank */
    batch.ledgerIds = []; batch.loanAdj = []; batch.relinked = [];
    const loanGroup = S.groups.find(g => g.entityId === entity.id && g.key === 'loans') || S.groups.find(g => g.entityId === entity.id && g.root === 'liability');
    const pre = [];
    for (const pl of loanPlans) {
      const used = pl.post || pl.matchOpening || keep.some(r => r.counterId === 'newloan:' + pl.i);
      if (!used) continue;
      if (pl.create) {
        const l = makeLedger({ entityId: entity.id, groupId: loanGroup.id, name: loanName(pl), alias: String(pl.sec.acct), note: 'Loan account ' + pl.sec.acct + ' (from statement import)' });
        l.acctNo = String(pl.sec.acct);
        if (pl.matchOpening && pl.sec.opening != null) l.opening = pl.sec.opening;
        pre.push({ store: 'ledgers', put: l }); batch.ledgerIds.push(l.id); pl.ledgerId = l.id;
        for (const r of keep) if (r.counterId === 'newloan:' + pl.i) r.counterId = l.id;
      } else if (pl.matchOpening && pl.sec.opening != null) {
        const lg = c.lById.get(pl.ledgerId);
        const before = ledgerStatement(c, pl.ledgerId, { to: addDays(pl.sec.from, -1) }).closing;
        const delta = pl.sec.opening - before;
        if (delta) { pre.push({ store: 'ledgers', put: { ...lg, opening: (lg.opening || 0) + delta, acctNo: lg.acctNo || String(pl.sec.acct), updatedAt: nowISO() } }); batch.loanAdj.push({ ledgerId: lg.id, delta }); }
      }
      if (pl.post && !pl.interestId) {
        const had = c.ledgers.find(l => !l.archived && l.name.toLowerCase() === 'loan interest');
        const il = await store.ensureLedgerNamed(entity.id, 'finexp', 'Loan Interest', { taxTag: 'none' });
        if (!had) batch.ledgerIds.push(il.id);
        pl.interestId = il.id;
      }
    }
    if (pre.length) await store.commit(pre);
    const c2 = store.ctxOf(entity.id);
    const relink = keep.filter(r => r.pair && r.counterId === r.pair.moneyId && c2.vouchers.some(v => v.id === r.pair.voucher.id));
    const vouchers = keep.filter(r => !relink.includes(r)).map(r => rowToVoucher(c2, args.ledgerId, r, batch.id, res.bank));
    for (const pl of loanPlans) if (pl.post && pl.ledgerId) vouchers.push(...loanSectionVouchers(c2, pl.sec, { loanId: pl.ledgerId, interestId: pl.interestId, chargesId: charges ? charges.id : '', batchId: batch.id }));
    const extra = [{ store: 'batches', put: batch }];
    if (adj.on && adj.amount) extra.push({ store: 'ledgers', put: { ...L, opening: (L.opening || 0) + adj.amount, updatedAt: nowISO() } });
    /* own transfers: the entry already imported from the other account becomes one transfer (kept for undo) */
    const pool = S.vouchers.slice();
    for (const r of relink) {
      const orig = c2.vouchers.find(v => v.id === r.pair.voucher.id);
      const nv = relinkAsTransfer(c2, args.ledgerId, { ...r, pair: { ...r.pair, voucher: orig } });
      const errs = validateVoucher(c2, nv, { isNew: false, previous: orig });
      if (errs.length) return toast(fmtDate(r.date) + ': ' + errs.join(' '));
      if (nv.type !== orig.type) nv.no = nextNumber(pool, nv.entityId, nv.type, nv.date);
      nv.meta.ownTransfer.batch2 = batch.id;
      nv.updatedAt = nowISO(); pool.push(nv);
      batch.relinked.push({ before: orig });
      extra.push({ store: 'vouchers', put: nv });
    }
    batch.count = vouchers.length + relink.length;
    try {
      await store.saveVouchers(vouchers, extra);
    } catch (e) { return toast(e.message); }
    md.close();
    const recon = res.closing != null ? ledgerStatement(store.ctx(), args.ledgerId, { to: res.to }).closing - res.closing : null;
    const loanChecks = loanPlans.filter(pl => pl.ledgerId && pl.sec.closing != null).map(pl => {
      const lg = store.ledger(pl.ledgerId);
      const end = pl.sec.to > res.to ? pl.sec.to : res.to; /* the loan pages close on the statement's last day */
      const off = ledgerStatement(store.ctx(), pl.ledgerId, { to: end }).closing - pl.sec.closing;
      return h('div', { class: 'note ' + (off === 0 ? 'ok' : 'warn') }, off === 0 ? '✓ ' + lg.name + ' matches the bank: you owe ' + money(Math.abs(pl.sec.closing)) + ' on ' + fmtDate(end) + '.'
        : lg.name + ' differs from the bank by ' + money(Math.abs(off)) + ' on ' + fmtDate(end) + ' (EMIs paid from another account are not in this statement).');
    });
    const done = openModal({
      title: 'Imported ' + keep.length + ' entr' + (keep.length === 1 ? 'y' : 'ies'), body: h('div', h('p', args.file.name + ' → ' + L.name),
        recon === null ? null : h('div', { class: 'note ' + (recon === 0 ? 'ok' : 'warn') }, recon === 0 ? '✓ Matches — the account balance on ' + fmtDate(res.to) + ' is the same as the bank’s.' : 'Differs from the bank by ' + money(Math.abs(recon)) + '. Look for missed or repeated rows, or correct the starting balance.'),
        relink.length ? h('div.note.ok', '⇄ ' + relink.length + ' transfer(s) between your own accounts recorded once (the earlier entr' + (relink.length === 1 ? 'y was' : 'ies were') + ' turned into transfers).') : null,
        loanChecks),
      foot: [h('button.btn.danger', { onclick: () => { done.close(); undoBatch(store.S.batches.find(b => b.id === batch.id)); } }, 'Undo this import'), h('button.btn.primary', { onclick: () => done.close() }, 'Done')]
    });
  }
  drawLoans();
}
function kpiBox(lbl, val, foot) { return h('div.kpi', h('div.lbl', lbl), h('div.val', { style: { fontSize: '16px' } }, val), foot ? h('div.foot', foot) : null); }

export async function undoBatch(b) {
  if (!b) return;
  const vs = S.vouchers.filter(v => v.batchId === b.id);
  const ent = store.entityById(b.entityId);
  if (ent && ent.lockedUpto && vs.some(v => v.date <= ent.lockedUpto)) return toast('Some entries are in a locked year. Unlock it first.');
  const shared = vs.find(v => v.meta && v.meta.ownTransfer && v.meta.ownTransfer.batch2 && S.batches.some(x => x.id === v.meta.ownTransfer.batch2));
  if (shared) { const other = S.batches.find(x => x.id === shared.meta.ownTransfer.batch2); return toast('Undo the later import first (' + (other.file || batchLabel(other)) + ') — it turned some of these entries into transfers.'); }
  const extraTxt = b.kind === 'legacy' ? ' It also removes accounts, rules, holdings and tax P&L it created, and puts starting balances back.'
    : (b.relinked && b.relinked.length ? ' Transfers it matched go back to the separate entries they were.' : '') + ((b.ledgerIds && b.ledgerIds.length) || (b.loanAdj && b.loanAdj.length) ? ' Loan accounts / starting balances it set are undone.' : '') + (b.openingAdj ? ' It also puts the starting balance back.' : '');
  if (!(await confirmBox('Undo this import?', 'Removes its ' + vs.length + ' entr' + (vs.length === 1 ? 'y' : 'ies') + ', including any you changed since.' + extraTxt, 'Undo import', true))) return;
  const ops = vs.map(v => ({ store: 'vouchers', del: v.id }));
  if (b.kind === 'statement' && b.openingAdj) { const l = store.ledger(b.ledgerId); if (l) ops.push({ store: 'ledgers', put: { ...l, opening: (l.opening || 0) - b.openingAdj } }); }
  if (b.kind === 'statement') {
    /* own transfers go back to the entries they were; loan starting balances and accounts this import created are undone */
    for (const x of b.relinked || []) ops.push({ store: 'vouchers', put: x.before });
    for (const a of b.loanAdj || []) { const l = store.ledger(a.ledgerId); if (l) ops.push({ store: 'ledgers', put: { ...l, opening: (l.opening || 0) - a.delta } }); }
    const remaining = S.vouchers.filter(v => v.batchId !== b.id);
    for (const id of b.ledgerIds || []) if (!remaining.some(v => v.lines.some(x => x.ledgerId === id))) ops.push({ store: 'ledgers', del: id });
  }
  if (b.kind === 'legacy') {
    const remaining = S.vouchers.filter(v => v.batchId !== b.id);
    for (const [id, d] of Object.entries(b.openingDeltas || {})) { const l = store.ledger(id); if (l && !(b.ledgerIds || []).includes(id)) ops.push({ store: 'ledgers', put: { ...l, opening: (l.opening || 0) - d } }); }
    for (const id of b.ledgerIds || []) if (!remaining.some(v => v.lines.some(x => x.ledgerId === id))) ops.push({ store: 'ledgers', del: id });
    for (const c of ['holdings', 'taxpnl', 'rules']) for (const r of S[c].filter(x => x.batchId === b.id)) ops.push({ store: c, del: r.id });
    if (b.sitesAdded && b.sitesAdded.length) { const me = store.entityById(b.meEntityId); if (me) ops.push({ store: 'entities', put: { ...me, sites: me.sites.filter(s => !b.sitesAdded.includes(s.id)) } }); }
  }
  if (b.kind === 'zerodha_pnl') {
    const remaining = S.vouchers.filter(v => v.batchId !== b.id);
    for (const id of b.assetIds || []) if (!remaining.some(v => v.meta && v.meta.inv && v.meta.inv.assetId === id)) ops.push({ store: 'assets', del: id });
  }
  ops.push({ store: 'batches', del: b.id });
  await store.commit(ops);
  toast('Import undone · ' + vs.length + ' removed');
}

/* ================= rules ================= */
export function editRule(rule, preset = {}, after) {
  const entity = store.activeEntity();
  const c = store.ctxOf(entity.id);
  const st = { pattern: rule ? rule.pattern : preset.pattern || '', ledgerId: rule ? rule.ledgerId : preset.ledgerId || '', dir: rule ? rule.dir || 'any' : preset.dir || 'any', off: rule ? !!rule.off : false };
  const pat = h('input.inp', { value: st.pattern, placeholder: 'e.g. swiggy, pnh, lic', autofocus: true });
  const dir = select([{ value: 'any', label: 'Money in or out' }, { value: 'debit', label: 'Money out only' }, { value: 'credit', label: 'Money in only' }], st.dir);
  const off = h('input', { type: 'checkbox', checked: st.off });
  const md = openModal({
    title: rule ? 'Edit rule' : 'New rule', sub: 'When the bank description contains this word, the category is filled in for you.',
    body: h('div.grid', field('Word', pat), field('Category', ledgerCombo(c, 'all', st.ledgerId, id => { st.ledgerId = id; })), field('Applies to', dir), rule ? h('label.check', off, 'Rule switched off') : null),
    foot: [rule ? h('button.btn.danger.left', { onclick: async () => { await store.commit([{ store: 'rules', del: rule.id }]); md.close(); toast('Rule deleted'); } }, 'Delete') : null,
      h('button.btn', { onclick: () => md.close() }, 'Cancel'),
      h('button.btn.primary', { onclick: async () => {
        if (!pat.value.trim() || !st.ledgerId) return toast('Word and category are required');
        const rec = { ...(rule || { id: uid('rul'), entityId: entity.id, createdAt: nowISO() }), pattern: pat.value.trim(), ledgerId: st.ledgerId, dir: dir.value, off: off.checked };
        await store.commit([{ store: 'rules', put: rec }]); md.close(); toast('Rule saved');
        if (after) after(rec);
      } }, 'Save')]
  });
}

/* ================= old DoctorWealth ================= */
export async function importLegacy() {
  let found = null;
  try { const raw = localStorage.getItem(LEGACY_KEY); if (raw) found = JSON.parse(raw); } catch { found = null; }
  const md = openModal({
    title: 'Import old DoctorWealth data', sub: 'Reads the old app’s data once and maps it to these books. The old data stays untouched.',
    body: h('div.grid',
      found && looksLegacy(found) ? h('div.note.ok', '✓ Found DoctorWealth data in this browser (' + (found.accounts || []).length + ' accounts, ' + ((found.income || []).length + (found.expenses || []).length) + ' entries).') : h('div.note', 'No old data found in this browser. Use a backup file from the old app (Settings → Export JSON / backup).'),
      found && looksLegacy(found) ? h('button.btn.primary', { onclick: () => { md.close(); legacyReview(found, 'this browser'); } }, 'Use data from this browser') : null,
      h('button.btn', { onclick: async () => { const f = await pickFile('.json,application/json'); if (!f) return; try { const o = JSON.parse(await f.text()); if (!looksLegacy(o)) return toast('That is not a DoctorWealth (old app) file.'); md.close(); legacyReview(o, f.name); } catch { toast('Could not read the file'); } } }, 'Choose old backup file (.json)…'))
  });
}

function legacyReview(raw, source) {
  const s = normalizeLegacy(raw);
  if (S.batches.some(b => b.kind === 'legacy')) toast('Note: old data was imported before. Undo that import first to avoid double entries.');
  const persons = store.sortedEntities().filter(e => e.kind !== 'demo');
  const st = { me: (persons[0] || {}).id, spouse: (persons[1] || persons[0] || {}).id };
  const mapping = {};
  const targets = () => ({ me: store.dataOf(st.me), spouse: store.dataOf(st.spouse) });
  Object.assign(mapping, suggestMapping(s, targets()));
  const body = h('div');
  const accBox = h('div');
  const checks = h('div');
  const entSel = key => select(persons.map(e => ({ value: e.id, label: e.name })), st[key], { onchange: e => { st[key] = e.target.value; Object.assign(mapping, suggestMapping(s, targets())); drawAcc(); } });
  add(body, h('p.small.muted', { style: { marginTop: 0 } }, 'Source: ' + source + ' · ' + s.accounts.length + ' accounts · ' + s.income.length + ' income · ' + s.expenses.length + ' expenses · ' + s.transfers.length + ' transfers · ' + s.loans.length + ' loans · ' + s.investments.length + ' investments'),
    h('div.grid.g2', field('“You” in the old app goes to', entSel('me')), field('“Spouse” in the old app goes to', entSel('spouse'))),
    h('div.section-h', h('h2', 'Accounts'), h('span.muted.small', 'match each old account to one here, or create it')), accBox,
    h('div.section-h', h('h2', 'Balance check'), h('button.btn.sm', { onclick: drawChecks }, 'Re-check')), checks);
  function drawAcc() {
    clear(accBox);
    const tb = h('tbody');
    for (const a of s.accounts) {
      const o = ownerOfAccount(s, a.id);
      const t = targets()[o] || targets().me;
      const c = makeCtx({ ...t, vouchers: [] });
      const opts = [{ value: '', label: '+ Create “' + a.name + '”' }, ...ledgerItems(c, l => l.system !== 'capital').map(x => ({ value: x.id, label: x.group + ' › ' + x.label }))];
      add(tb, h('tr', h('td', a.name, h('div.narr', a.type + ' · ' + (o === 'spouse' ? 'Spouse' : 'You'))), h('td.r.amt', money(a.opening || 0)), h('td', select(opts, mapping['acc:' + a.id] || '', { class: 'inp sm', onchange: e => { mapping['acc:' + a.id] = e.target.value; drawChecks(); } }))));
    }
    add(accBox, h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Old account'), h('th.r', 'Old starting balance'), h('th', 'Becomes'))), tb)),
      h('p.small.muted', 'Income and spending categories are matched by name; anything without a match is created, with sensible tax treatment (hospital / clinic → practice income). You can rename them later.'));
    drawChecks();
  }
  let plan = null;
  function drawChecks() {
    clear(checks);
    try { plan = buildLegacyPlan(s, targets(), mapping); } catch (e) { add(checks, h('div.note.bad', 'Could not build the import: ' + e.message)); plan = null; return; }
    const ok = plan.checks.every(x => x.actual === x.expected);
    add(checks, h('div', { class: 'note ' + (ok ? 'ok' : 'bad') }, ok ? '✓ Every old account balance comes out exactly the same here.' : '⚠ Some balances differ — see below.'),
      h('div.tbl-wrap', { style: { marginTop: '8px' } }, h('table.tbl', h('thead', h('tr', h('th', 'Old account'), h('th', 'Here'), h('th.r', 'Old app balance'), h('th.r', 'After import'), h('th'))),
        h('tbody', plan.checks.map(x => h('tr', h('td', x.name), h('td', x.ledger.name, x.ledger.legacy ? h('span.pill', { style: { marginLeft: '6px' } }, 'new') : null), h('td.r.amt', money(x.old)), h('td.r.amt', money(x.actual)), h('td', x.actual === x.expected ? h('span.in', '✓') : h('span.out', 'differs'))))))),
      h('p.small', plan.vouchers.length + ' entries · ' + plan.newLedgers.length + ' new accounts / categories · ' + plan.holdings.length + ' holdings · ' + plan.taxPnl.length + ' tax P&L · ' + plan.rules.length + ' rules'),
      plan.warnings.map(w => h('div.note.warn', { style: { marginTop: '6px' } }, w)),
      plan.newLedgers.some(l => l.system === 'suspense' && plan.vouchers.some(v => v.lines.some(x => x.ledgerId === l.id))) || plan.vouchers.some(v => v.lines.some(x => (store.ledger(x.ledgerId) || {}).system === 'suspense'))
        ? h('div.note.warn', { style: { marginTop: '6px' } }, 'Some old entries had no account; they go to “To sort later” so nothing is lost.') : null);
  }
  drawAcc();
  const md = openModal({
    title: 'Review old DoctorWealth import', size: 'xwide', sticky: true, body,
    foot: [h('span.left.small.muted', 'Can be undone in one click from Import history.'), h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: commit }, 'Import')]
  });
  async function commit() {
    if (!plan) return;
    if (!plan.checks.every(x => x.actual === x.expected) && !(await confirmBox('Balances differ', 'Import anyway?', 'Import'))) return;
    const me = store.entityById(st.me);
    const batch = { id: uid('bat'), entityId: st.me, kind: 'legacy', file: source, createdAt: nowISO(), count: plan.vouchers.length, ledgerIds: plan.newLedgers.map(l => l.id), openingDeltas: Object.fromEntries(plan.openingDeltas), meEntityId: st.me, sitesAdded: [] };
    const ops = [{ store: 'batches', put: batch }];
    for (const l of plan.newLedgers) ops.push({ store: 'ledgers', put: { ...l, opening: (l.opening || 0) + (plan.openingDeltas.get(l.id) || 0) } });
    for (const [id, d] of plan.openingDeltas) { if (plan.newLedgers.some(l => l.id === id)) continue; const l = store.ledger(id); if (l) ops.push({ store: 'ledgers', put: { ...l, opening: (l.opening || 0) + d } }); }
    for (const x of plan.holdings) ops.push({ store: 'holdings', put: { ...x, batchId: batch.id } });
    for (const x of plan.taxPnl) ops.push({ store: 'taxpnl', put: { ...x, batchId: batch.id } });
    for (const x of plan.rules) ops.push({ store: 'rules', put: { ...x, batchId: batch.id } });
    if (plan.sites.length) { const add = plan.sites.map(n => ({ id: uid('site'), name: n })); batch.sitesAdded = add.map(x => x.id); ops.push({ store: 'entities', put: { ...me, sites: [...(me.sites || []), ...add] } }); }
    for (const v of plan.vouchers) v.batchId = batch.id;
    try {
      /* ledgers first so validation sees them, then the vouchers */
      await store.commit(ops);
      await store.saveVouchers(plan.vouchers);
    } catch (e) { toast('Import failed: ' + e.message); return; }
    md.close();
    toast('Old data imported · ' + plan.vouchers.length + ' entries');
    await store.setSettings({ activeEntityId: st.me });
  }
}

/* ================= Zerodha P&L → entries ================= */
const SEG_NAME = { intraday: 'Intraday shares', futures: 'F&O – futures', options: 'F&O – options' };
const KIND_NAME = { short: 'Short term', long: 'Long term', buyback: 'Buyback', nonequity: 'Non-equity ETF', mf: 'Mutual fund' };
export async function importZerodhaPnl() {
  const f = await pickFile('.xlsx,.xls,.csv'); if (!f) return;
  let sheets;
  try { sheets = /\.csv$/i.test(f.name) ? { Sheet1: parseCSV(await f.text()) } : await readWorkbook(await f.arrayBuffer()); }
  catch (e) { return toast('Could not read the file: ' + e.message); }
  const summary = parseTaxPnl(sheets, f.name, S.settings.fy);
  const trades = parseTradewise(sheets, parseDateAny);
  if (!trades.error) return reviewZerodhaPnl(f, trades.rows, summary.error ? null : summary);
  const con = parseConsolePnl(sheets, f.name);
  if (!con.error) return reviewConsolePnl(f, con);
  if (!summary.error) return editTaxSummary(f, summary);
  openModal({ title: 'Not imported', body: h('div.note.warn', 'This does not look like a Zerodha P&L file. In Console use Reports → Tax P&L (download Excel) — it has the “Tradewise Exits” sheet with dates — or Reports → P&L.') });
}
async function zerodhaWallet(e) {
  const c = store.ctxOf(e.id);
  const w = c.ledgers.find(l => !l.archived && l.broker === 'zerodha' && c.natureOf(l) === 'wallet');
  return w || store.ensureLedgerNamed(e.id, 'wallets', 'Zerodha wallet (Kite funds)', { broker: 'zerodha', alias: 'kite zerodha wallet' });
}
async function reviewZerodhaPnl(f, rows, summary) {
  const e = store.activeEntity();
  const wallet = await zerodhaWallet(e);
  const c = store.ctxOf(e.id);
  const st = { walletId: wallet.id, saveSummary: !!summary };
  const plan = planZerodhaPnl(c, store.assetsOf(e.id), rows);
  const fyOfFile = rows.length ? fyOf(rows[rows.length - 1].exit || today()) : S.settings.fy;
  const sumBox = h('div');
  const drawSum = () => {
    const d = plan.delivery.filter(x => x.include), t = plan.trades.filter(x => x.include);
    const prof = d.reduce((s2, x) => s2 + x.row.profit, 0), tp = t.reduce((s2, x) => s2 + x.pl - x.charges, 0);
    clear(sumBox).appendChild(h('div.rev-sum',
      kpiBox('Shares & funds sold', String(d.length), d.filter(x => x.action === 'buy+sell').length + ' purchase(s) added too'),
      kpiBox('Profit on them (Zerodha)', amt(prof, { flow: true })),
      kpiBox('F&O / intraday days', String(t.length), 'net after charges ' + money(tp, { sign: true })),
      kpiBox('Already imported', String(plan.delivery.filter(x => x.dup).length + plan.trades.filter(x => x.dup).length), 'unticked')));
  };
  const dRows = plan.delivery.map(d => {
    const inc = h('input', { type: 'checkbox', checked: d.include, onchange: ev => { d.include = ev.target.checked; drawSum(); } });
    const what = h('div');
    const drawWhat = () => {
      clear(what);
      if (d.dup) { add(what, h('span.pill.warn', 'already imported')); return; }
      if (d.action === 'sell-only') add(what, h('span.pill.ok', 'sale only'), h('div.small.muted', 'uses your purchases in Portfolio · ', h('a', { href: '#', onclick: ev => { ev.preventDefault(); d.action = 'buy+sell'; drawWhat(); drawSum(); } }, 'add purchase too')));
      else add(what, h('span.pill.gold', 'purchase + sale'), h('div.small.muted', d.asset ? 'Portfolio holds less than this — purchase added' : 'new to Portfolio', d.asset ? [' · ', h('a', { href: '#', onclick: ev => { ev.preventDefault(); d.action = 'sell-only'; drawWhat(); drawSum(); } }, 'sale only')] : null));
    };
    drawWhat();
    return h('tr', h('td', inc), h('td', d.row.symbol, h('div.narr', KIND_NAME[d.row.kind] || d.row.kind)), h('td.nowrap', fmtDate(d.row.entry)), h('td.nowrap', fmtDate(d.row.exit)), h('td.r', String(d.row.qty)),
      h('td.r.amt', money(d.row.buy)), h('td.r.amt', money(d.row.sell)), h('td.r', amt(d.row.profit, { flow: true })), h('td', what));
  });
  const tRows = plan.trades.map(t => h('tr', h('td', h('input', { type: 'checkbox', checked: t.include, onchange: ev => { t.include = ev.target.checked; drawSum(); } })), h('td.nowrap', fmtDate(t.date)), h('td', SEG_NAME[t.segment], h('div.narr', t.count + ' trade(s): ' + t.symbols.join(', ') + (t.count > t.symbols.length ? '…' : ''))),
    h('td.r', amt(t.pl, { flow: true })), h('td.r.amt', money(t.charges)), h('td.r.amt', money(t.turnover)), h('td', t.dup ? h('span.pill.warn', 'already imported') : '')));
  const md = openModal({
    title: 'Review Zerodha P&L', sub: f.name + ' · ' + rows.length + ' closed trades. Nothing is saved until you approve.', size: 'xwide', sticky: true,
    body: h('div', sumBox,
      h('div.grid.g2', field('Money moves through', combo(ledgerItems(c, l => ['wallet', 'bank'].includes(c.natureOf(l))), st.walletId, id => { st.walletId = id; })), summary ? h('label.check', { style: { alignSelf: 'end' } }, h('input', { type: 'checkbox', checked: st.saveSummary, onchange: ev => { st.saveSummary = ev.target.checked; } }), h('span', 'Also save the yearly tax summary', h('div.small.muted', 'gains, F&O and dividend totals for the tax phase'))) : h('span')),
      plan.delivery.length ? [h('div.section-h', h('h2', 'Shares & funds sold')), h('div.tbl-wrap', { style: { maxHeight: '36vh', overflowY: 'auto' } }, h('table.tbl.rev-tbl', h('thead', h('tr', h('th', '✓'), h('th', 'Symbol'), h('th', 'Bought'), h('th', 'Sold'), h('th.r', 'Qty'), h('th.r', 'Buy value'), h('th.r', 'Sell value'), h('th.r', 'Profit'), h('th', 'What will be added'))), h('tbody', dRows)))] : null,
      plan.trades.length ? [h('div.section-h', h('h2', 'F&O / intraday (one entry per day)')), h('div.tbl-wrap', { style: { maxHeight: '26vh', overflowY: 'auto' } }, h('table.tbl.rev-tbl', h('thead', h('tr', h('th', '✓'), h('th', 'Date'), h('th', 'Segment'), h('th.r', 'P&L'), h('th.r', 'Charges'), h('th.r', 'Turnover'), h('th'))), h('tbody', tRows)))] : null,
      h('p.small.muted', 'Sales use oldest-first (FIFO) like Zerodha. Brokerage and exchange charges reduce the sale value; STT on share sales is recorded separately because it is not allowed against capital gains. Purchases and sales go through the wallet, so money you added to it from the bank is counted once.')),
    foot: [h('span.left.small.muted', 'Can be undone from Import history.'), h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: approve }, 'Approve & add')]
  });
  drawSum();
  async function approve() {
    if (!plan.delivery.some(x => x.include) && !plan.trades.some(x => x.include)) { if (!(st.saveSummary && summary)) return toast('Nothing selected'); }
    try {
      const types = new Set(plan.delivery.filter(x => x.include && !x.asset).map(x => ({ mf: 'equity_mf', nonequity: 'etf_other' }[x.row.kind] || 'equity')));
      const ledgerByType = {};
      for (const tp of types) { const T = ASSET_TYPES[tp]; ledgerByType[tp] = (await store.ensureLedgerNamed(e.id, T.fixed ? 'fixed' : 'invest', T.ledger)).id; }
      const stocks = (await store.ensureLedgerNamed(e.id, 'invest', 'Stocks')).id;
      const stt = (await store.ensureLedgerNamed(e.id, 'personal', 'STT on share sales (not deductible)', { taxTag: 'personal' })).id;
      const batchId = uid('bat');
      const c2 = store.ctxOf(e.id);
      const out = buildZerodhaPostings(c2, store.assetsOf(e.id), plan, { walletId: st.walletId, ledgerForType: tp => ledgerByType[tp] || stocks, sttLedgerId: stt, batchId });
      if (out.problems.length && !(await confirmBox('Some sales are larger than the holdings', out.problems.join(' · ') + ' — continue anyway?', 'Continue'))) return;
      const keyIds = {};
      for (const v of out.vouchers) for (const l of v.lines) if (!c2.lById.has(l.ledgerId) && !keyIds[l.ledgerId]) keyIds[l.ledgerId] = (await store.ensureGainLedger(e.id, l.ledgerId)).id;
      const vouchers = out.vouchers.map(v => ({ ...v, lines: tidyLines(v.lines.map(l => (keyIds[l.ledgerId] ? { ...l, ledgerId: keyIds[l.ledgerId] } : l))) }));
      const batch = { id: batchId, entityId: e.id, kind: 'zerodha_pnl', file: f.name, count: vouchers.length, assetIds: out.newAssets.map(a => a.id), createdAt: nowISO() };
      const ops = [{ store: 'batches', put: batch }, ...out.newAssets.map(a => ({ store: 'assets', put: a }))];
      if (st.saveSummary && summary) {
        const existing = S.taxpnl.find(x => x.entityId === e.id && x.fy === (summary.fy || fyOfFile));
        ops.push({ store: 'taxpnl', put: { id: existing ? existing.id : uid('tpl'), entityId: e.id, fy: summary.fy || fyOfFile, file: f.name, source: 'zerodha', batchId, ledgerClose: summary.ledgerClose, dividendRows: summary.dividendRows, createdAt: nowISO(), stcg: summary.stcg, ltcg: summary.ltcg, intraday: summary.intraday, nonEquity: summary.nonEquity, foOptions: summary.foOptions, foFutures: summary.foFutures, dividends: summary.dividends } });
      }
      await store.commit(ops);
      if (vouchers.length) await store.saveVouchers(vouchers);
      md.close();
      toast('Zerodha P&L added · ' + vouchers.length + ' entries');
      location.hash = '#/gains';
    } catch (err) { toast(err.message); }
  }
}
async function reviewConsolePnl(f, con) {
  const e = store.activeEntity();
  const wallet = await zerodhaWallet(e);
  const c = store.ctxOf(e.id);
  const st = { walletId: wallet.id };
  const total = con.items.reduce((s2, x) => s2 + x.profit, 0);
  const seg = select([{ value: 'futures', label: 'F&O – futures' }, { value: 'options', label: 'F&O – options' }, { value: 'intraday', label: 'Intraday shares' }], con.segment === 'intraday' ? 'intraday' : con.items.some(x => /(CE|PE)$/i.test(x.symbol)) ? 'options' : 'futures');
  const date = dateInput(fyRange(S.settings.fy).to < today() ? fyRange(S.settings.fy).to : today());
  const charges = amountInput(con.charges);
  const isEquity = con.segment === 'equity';
  const md = openModal({
    title: 'Review Zerodha P&L (Console)', sub: f.name + ' · ' + con.items.length + ' symbols · realised ' + money(total, { sign: true }), size: 'wide',
    body: h('div',
      isEquity ? h('div.note.warn', 'This P&L has no buy and sell dates, so short / long term cannot be worked out. For shares and funds please import the Tax P&L file (it has the “Tradewise Exits” sheet). You can still add the total below as one trading result if these were intraday trades.') : null,
      h('div.tbl-wrap', { style: { maxHeight: '36vh', overflowY: 'auto' } }, h('table.tbl', h('thead', h('tr', h('th', 'Symbol'), h('th.r', 'Buy value'), h('th.r', 'Sell value'), h('th.r', 'Realised P&L'))), h('tbody', con.items.map(x => h('tr', h('td', x.symbol), h('td.r.amt', money(x.buy)), h('td.r.amt', money(x.sell)), h('td.r', amt(x.profit, { flow: true }))))))),
      h('div.grid.g4', { style: { marginTop: '10px' } }, field('Add as', seg), field('Date of the entry', date, 'e.g. last day of the period'), field('Charges', charges), field('Money moves through', combo(ledgerItems(c, l => ['wallet', 'bank'].includes(c.natureOf(l))), st.walletId, id => { st.walletId = id; })))),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: async () => {
      const dup = c.vouchers.some(v => v.meta && v.meta.trade && v.date === date.value && v.meta.trade.pl === total);
      if (dup && !(await confirmBox('Already imported?', 'A trading result with the same date and amount exists.', 'Add anyway'))) return;
      const plId = (await store.ensureGainLedger(e.id, seg.value === 'intraday' ? 'trade_intraday' : 'trade_fo')).id;
      const ch = charges.paise();
      const chId = ch ? (await store.ensureGainLedger(e.id, 'trade_charges')).id : null;
      const net = total - ch;
      const lines = tidyLines([total > 0 ? { ledgerId: plId, cr: total } : total < 0 ? { ledgerId: plId, dr: -total } : null, ch ? { ledgerId: chId, dr: ch } : null, net > 0 ? { ledgerId: st.walletId, dr: net } : net < 0 ? { ledgerId: st.walletId, cr: -net } : null].filter(Boolean));
      const turnover = con.items.reduce((s2, x) => s2 + Math.abs(x.profit), 0);
      const batchId = uid('bat');
      try {
        await store.commit([{ store: 'batches', put: { id: batchId, entityId: e.id, kind: 'zerodha_pnl', file: f.name, count: 1, assetIds: [], createdAt: nowISO() } }]);
        await store.saveVouchers([newVoucher(e.id, { type: net >= 0 ? 'receipt' : 'payment', src: 'trading', date: date.value, narration: (SEG_NAME[seg.value] || '') + ' – Zerodha P&L', batchId, lines, meta: { trade: { segment: seg.value, pl: total, charges: ch, stt: 0, premium: Math.max(0, turnover - Math.abs(total)), source: 'zerodha-pnl' } } })]);
        md.close(); toast('Added to F&O / intraday'); location.hash = '#/trading';
      } catch (err) { toast(err.message); }
    } }, 'Add')]
  });
}

/* ================= Zerodha ================= */
function editTaxSummary(f, res) {
  const persons = store.sortedEntities();
  const ent = select(persons.map(e => ({ value: e.id, label: e.name })), store.activeEntity().id);
  const fy = select(fyList(8, 1).map(x => ({ value: x, label: 'FY ' + x })), res.fy);
  const keys = [['stcg', 'Short-term profit (STCG)'], ['ltcg', 'Long-term profit (LTCG)'], ['intraday', 'Intraday / speculative'], ['nonEquity', 'Non-equity profit'], ['foOptions', 'F&O options realised'], ['foFutures', 'F&O futures realised'], ['dividends', 'Dividends (net)']];
  const inputs = Object.fromEntries(keys.map(([k]) => [k, amountInput(res[k], { value: (res[k] / 100).toString() })]));
  const miss = keys.filter(([k]) => res.found && !res.found[k]).map(([, l]) => l);
  const md = openModal({
    title: 'Review tax P&L', sub: f.name + ' — check the figures against the report. Nothing is saved until you approve.' + (miss.length ? ' Not found (left at 0): ' + miss.join(', ') + '.' : ''), size: 'wide',
    body: h('div.grid.g2', field('Whose P&L', ent), field('Financial year', fy), ...keys.map(([k, l]) => field(l, inputs[k], k === 'dividends' && res.dividendRows ? res.dividendRows + ' dividend rows summed' : ''))),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: async () => {
      const existing = S.taxpnl.find(t => t.entityId === ent.value && t.fy === fy.value);
      if (existing && !(await confirmBox('Replace?', 'A tax P&L already exists for FY ' + fy.value + '.', 'Replace'))) return;
      const rec = { id: existing ? existing.id : uid('tpl'), entityId: ent.value, fy: fy.value, file: f.name, source: 'zerodha', ledgerClose: res.ledgerClose, dividendRows: res.dividendRows, createdAt: nowISO(), ...Object.fromEntries(keys.map(([k]) => [k, inputs[k].paise()])) };
      await store.commit([{ store: 'taxpnl', put: rec }]); md.close(); toast('Tax P&L saved · FY ' + fy.value);
    } }, 'Save')]
  });
}

/* password for a protected PDF (Zerodha uses the PAN in capitals); used once, never stored */
export function askPdfPassword(title, hint) {
  return new Promise(resolve => {
    let done = false;
    const inp = h('input.inp', { type: 'password', autocomplete: 'off', autofocus: true });
    const ok = () => { done = true; md.close(); resolve(inp.value); };
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') ok(); });
    const md = openModal({ title, body: h('div.grid', h('p.small.muted', { style: { margin: 0 } }, hint || 'Used only to open the file on this device; not saved.'), inp),
      foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: ok }, 'Open')], onClose: () => { if (!done) resolve(null); } });
  });
}
async function readHoldingsPdf(f) {
  let pw = '', title = 'This statement is password-protected';
  for (;;) {
    try { return parseDpHoldings((await readPdfItems(await f.arrayBuffer(), pw)).map(groupPdfItems)); }
    catch (err) {
      if (err.code !== 'PASSWORD_NEEDED' && err.code !== 'PASSWORD_WRONG') throw err;
      if (err.code === 'PASSWORD_WRONG') title = 'Wrong password — try again';
      pw = await askPdfPassword(title, 'Zerodha statements usually open with your PAN in capitals. Used only to open the file on this device; not saved.');
      if (pw === null) return null;
    }
  }
}
export async function importHoldings() {
  const f = await pickFile('.xlsx,.xls,.csv,.pdf,application/pdf'); if (!f) return;
  let res;
  try {
    if (/\.pdf$/i.test(f.name)) { res = await readHoldingsPdf(f); if (!res) return; }
    else {
      const rows = /\.csv$/i.test(f.name) ? parseCSV(await f.text()) : Object.values(await readWorkbook(await f.arrayBuffer()))[0];
      res = parseHoldings(rows);
    }
  } catch (e) { return toast('Could not read the file: ' + e.message); }
  if (res.error) return openModal({ title: 'Not imported', body: h('div.note.warn', res.error) });
  const e = store.activeEntity();
  const c = store.ctx();
  const assets = store.assetsOf(e.id);
  const dp = res.source === 'dp', priceDate = res.asOf || today();
  /* ISIN first, then symbol, then the company name reduced to a key ("HDFC BANK-EQ1/-" ~ "HDFCBANK") */
  const match = x => assets.find(a => x.isin && a.isin === x.isin)
    || assets.find(a => a.symbol && a.symbol === x.symbol.toUpperCase())
    || assets.find(a => { const k = holdingKey(a.symbol || a.name), k2 = holdingKey(x.name || x.symbol); return k && k2 && (k === k2 || (k.length >= 6 && k2.length >= 6 && (k.startsWith(k2) || k2.startsWith(k)))); });
  const plan = res.items.map(x => {
    const a = match(x);
    const held = a ? valueAsset(a, c.vouchers).qty : 0;
    return { x, a, held, action: !a ? 'create' : held ? 'price' : 'lots' };
  });
  const toAdd = plan.filter(p => p.action !== 'price').length;
  const since = dateInput('');
  /* new shares: owned before using the app (starting balance) or bought recently with wallet / bank money (purchases) */
  const how = { mode: 'before', pay: (c.ledgers.find(l => !l.archived && l.broker === 'zerodha' && c.natureOf(l) === 'wallet') || {}).id || '' };
  const payBox = h('div');
  const drawHow = () => { clear(payBox); if (how.mode === 'paid') add(payBox, field('Paid from', combo(ledgerItems(c, l => ['bank', 'wallet', 'cash'].includes(c.natureOf(l))), how.pay, id => { how.pay = id; }))); };
  const howBox = h('div.grid', { style: { marginTop: '10px' } },
    h('label.check', h('input', { type: 'radio', name: 'hhow', checked: true, onchange: () => { how.mode = 'before'; drawHow(); } }), h('span', h('b', 'Owned before I started using this app'), h('div.small.muted', 'Added at Zerodha’s average cost as part of the starting balance — no money moves.'))),
    h('label.check', h('input', { type: 'radio', name: 'hhow', onchange: () => { how.mode = 'paid'; drawHow(); } }), h('span', h('b', 'Bought recently with money from my Zerodha wallet / bank'), h('div.small.muted', 'Recorded as purchases, so the wallet goes down by the same amount — counted once.'))),
    payBox);
  const md = openModal({
    title: 'Review holdings', sub: f.name + ' · ' + res.items.length + ' holdings' + (dp ? ' as on ' + fmtDate(priceDate) + ' · value ' + money(res.value) : ' · cost ' + money(res.cost) + ' · value ' + money(res.value)), size: 'wide',
    body: h('div',
      h('div.tbl-wrap', { style: { maxHeight: '45vh', overflowY: 'auto' } }, h('table.tbl', h('thead', h('tr', h('th', 'Symbol'), h('th.r', 'Qty'), h('th.r', 'Avg'), h('th.r', 'Price'), h('th.r', 'Cost'), h('th', 'In Portfolio'))),
        h('tbody', plan.map(p => h('tr', h('td', p.x.name || p.x.symbol, p.x.isin ? h('div.narr', p.x.isin) : null), h('td.r', String(p.x.qty)), h('td.r.amt', p.x.noCost ? '—' : money(p.x.avg)), h('td.r.amt', money(p.x.ltp)), h('td.r.amt', p.x.noCost ? '—' : money(p.x.cost)),
          h('td', p.action === 'price' ? h('span.pill.ok', 'price updated' + (Math.abs(p.held - p.x.qty) > 1e-9 ? ' · you hold ' + p.held + ' here' : '')) : p.action === 'create' ? h('span.pill.gold', 'will be added') : h('span.pill.gold', 'holding will be added'))))))),
      toAdd ? howBox : null,
      toAdd ? h('div.grid.g2', { style: { marginTop: '10px' } }, field('Bought on (approximate) for the ones being added', since, 'The date decides short or long term. You can correct each one later in Portfolio.')) : null,
      dp ? h('div.note', 'The DP statement has quantities and today’s rate but no buy price. Shares you already track get the new price; for new ones the cost is taken as today’s value — correct the purchase price later in Portfolio if you know it (it matters for capital gains).') : null,
      h('p.small.muted', 'Shares you already track only get today’s price. New ones are added as “already owned” at ' + (dp ? 'today’s value' : 'Zerodha’s average cost') + ' — part of the Stocks account’s starting balance, no money moves.')),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: async () => {
      if (toAdd && !since.value) return toast('Enter the approximate purchase date');
      if (toAdd && how.mode === 'paid' && !how.pay) return toast('Choose where the money came from');
      const ops = [], buys = [];
      const lotOrBuy = (assetId, x) => {
        if (how.mode === 'before') return [{ id: uid('lot'), date: since.value, qty: x.qty, cost: x.cost, fmv2018: 0 }];
        buys.push({ assetId, x });
        return [];
      };
      const stocks = await store.ensureLedgerNamed(e.id, 'invest', 'Stocks');
      for (const p of plan) {
        const etf = /BEES$|ETF$/i.test(p.x.symbol) || /^INF/i.test(p.x.isin || '');
        if (p.action === 'create') {
          const id = uid('ast');
          ops.push({ store: 'assets', put: { id, entityId: e.id, name: p.x.name || p.x.symbol, type: etf ? 'etf' : 'equity', symbol: p.x.symbol.toUpperCase(), isin: p.x.isin || '', ledgerId: stocks.id, price: p.x.ltp, priceDate, priceSource: 'zerodha', costUnknown: !!p.x.noCost,
            openingLots: lotOrBuy(id, p.x), events: [], archived: false, createdAt: nowISO(), updatedAt: nowISO() } });
        } else if (p.action === 'lots') {
          ops.push({ store: 'assets', put: { ...p.a, isin: p.a.isin || p.x.isin || '', price: p.x.ltp || p.a.price, priceDate, openingLots: [...(p.a.openingLots || []), ...lotOrBuy(p.a.id, p.x)], updatedAt: nowISO() } });
        } else if (p.x.ltp) ops.push({ store: 'assets', put: { ...p.a, isin: p.a.isin || p.x.isin || '', price: p.x.ltp, priceDate, priceSource: 'zerodha', updatedAt: nowISO() } });
      }
      const old = S.holdings.filter(x => x.entityId === e.id && x.source === 'zerodha');
      ops.push(...old.map(x => ({ store: 'holdings', del: x.id })));
      for (const x of res.items) ops.push({ store: 'holdings', put: { id: uid('hld'), entityId: e.id, ledgerId: stocks.id, name: x.name || x.symbol, isin: x.isin, type: 'Stocks', qty: x.qty, avg: x.avg, ltp: x.ltp, cost: x.cost, value: x.value, broker: 'Zerodha', source: 'zerodha', asOf: priceDate, createdAt: nowISO() } });
      await store.commit(ops);
      if (buys.length) {
        const vs = buys.map(b => newVoucher(e.id, { type: 'payment', src: 'investment', date: since.value, narration: 'Bought ' + b.x.symbol + ' (from holdings import)',
          lines: [{ ledgerId: stocks.id, dr: b.x.cost, cr: 0 }, { ledgerId: how.pay, dr: 0, cr: b.x.cost }], meta: { inv: { assetId: b.assetId, action: 'buy', qty: b.x.qty, cost: b.x.cost, price: b.x.avg, charges: 0 } } }));
        try { await store.saveVouchers(vs); } catch (err) { toast(err.message); return; }
      }
      md.close();
      toast(toAdd ? toAdd + ' added to Portfolio' + (buys.length ? ' as purchases' : '') + ', prices updated' : 'Prices updated');
      location.hash = '#/portfolio';
    } }, toAdd ? 'Add to Portfolio' : 'Update prices')]
  });
}

/* ================= backup ================= */
export async function restoreBackup() {
  const f = await pickFile('.json,application/json'); if (!f) return;
  let o;
  try { o = JSON.parse(await f.text()); } catch { return toast('Could not read the file'); }
  if (looksLegacy(o)) { toast('This is an old DoctorWealth file — opening the migration instead.'); return legacyReview(o, f.name); }
  if (!store.isOwnBackup(o)) return toast('Not a DoctorWealth Books backup');
  if (!(await confirmBox('Replace all data?', `Backup from ${fmtDate((o.exportedAt || '').slice(0, 10))}: ${o.entities.length} entities, ${o.vouchers.length} entries. Current data is snapshotted on this device first.`, 'Replace all data', true))) return;
  try { await store.restoreAll(o); toast('Backup restored'); location.hash = '#/dashboard'; } catch (e) { toast(e.message); }
}
