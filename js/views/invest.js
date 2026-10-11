/* Investments (Phase 2): portfolio, one investment, buy / sell with FIFO, income, deposits, prices,
   capital gains and the light F&O / intraday section. Every action posts an ordinary entry. */
import { h, clear, money, amt, add } from '../ui/dom.js';
import { openModal, toast, confirmBox, amountInput, dateInput, select, field, combo, exportTable, xr } from '../ui/widgets.js';
import { ledgerItems, ledgerCombo, periodControl, currentPeriod, period } from '../ui/pickers.js';
import * as store from '../app/store.js';
import { S } from '../app/store.js';
import { ASSET_TYPES, typeOf, fifo, classify, valueAsset, saleLines, capitalGains, tradingSummary, unlinked, depositState, roundQty, assetTxns } from '../core/invest.js';
import { rulesFor, termOf, FO_AUDIT_TURNOVER } from '../core/taxrules.js';
import { newVoucher, tidyLines, inferType } from '../core/vouchers.js';
import { balances } from '../core/books.js';
import { toPaise, formatINR } from '../lib/money.js';
import { fmtDate, today, fyOf, fyRange, addMonths, isDate } from '../lib/dates.js';
import { uid, nowISO, clone } from '../lib/util.js';
import { t, isCA, ledgerName } from '../ui/terms.js';

const go = (...p) => { location.hash = '#/' + p.join('/'); };
const fmtQty = (q, a) => (q == null ? '' : Number(q).toLocaleString('en-IN', { maximumFractionDigits: typeOf(a).dp ?? 8 }));
const pct = (g, c) => (c ? (g / c * 100).toFixed(1) + '%' : '');
const ui = { showClosed: false };

/* accounts money can come from / go to: cash, bank, card and broker cash such as "Zerodha Funds" */
function payItems(c) {
  const assetLedgers = new Set(store.assetsOf(c.entity.id).map(a => a.ledgerId));
  const typical = new Set(Object.values(ASSET_TYPES).map(x => x.ledger));
  return ledgerItems(c, l => ['cash', 'bank', 'card'].includes(c.natureOf(l)) || (c.natureOf(l) === 'investment' && !assetLedgers.has(l.id) && !typical.has(l.name)));
}
/* the person's chosen default account, else their first bank account in list order */
const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name);
const defaultPay = c => {
  const pref = S.settings.defaultMoney[c.entity.id];
  if (pref && c.lById.has(pref) && c.natureOf(c.lById.get(pref)) === 'bank') return pref;
  const b = c.ledgers.filter(l => !l.archived && c.natureOf(l) === 'bank').sort(byOrder)[0];
  return (b || c.ledgers.find(l => /zerodha|kite/i.test(l.name + l.alias)) || {}).id || '';
};

/* ======================= portfolio ======================= */
export function renderPortfolio(root) {
  const e = store.activeEntity();
  const c = store.ctx();
  const assets = store.assetsOf(e.id).filter(a => !a.archived);
  const vals = assets.map(a => valueAsset(a, c.vouchers));
  const open = vals.filter(v => ui.showClosed || !(v.qty === 0 || v.asset.closed));
  const tot = { cost: 0, value: 0, gain: 0, booked: 0 };
  for (const v of vals) { tot.cost += v.cost; tot.value += v.value; tot.gain += v.value - v.cost; tot.booked += v.realisedThisYear; }

  add(root, h('div.toolbar',
    h('button.btn.primary', { onclick: () => openAssetForm() }, '+ Add investment'),
    h('button.btn', { onclick: () => openBuy() }, 'Buy / invest'),
    h('button.btn', { onclick: () => openSell() }, 'Sell / redeem'),
    h('button.btn', { onclick: () => openIncome() }, 'Dividend / interest'),
    h('button.btn', { onclick: () => go('prices') }, 'Update prices'),
    h('span.spacer'),
    h('label.check.small', h('input', { type: 'checkbox', checked: ui.showClosed, onchange: ev => { ui.showClosed = ev.target.checked; window.dispatchEvent(new HashChangeEvent('hashchange')); } }), 'Show sold / closed')));

  add(root, h('div.kpis',
    kpi('Invested (what I paid)', amt(tot.cost)),
    kpi('Worth today', amt(tot.value), 'at the prices you entered'),
    kpi('Gain on what I hold', amt(tot.gain, { flow: true }), pct(tot.gain, tot.cost)),
    kpi('Profit booked · FY ' + fyOf(today()), amt(tot.booked, { flow: true }), h('a', { href: '#/gains' }, 'Capital gains →'))));

  alerts(root, c, assets, vals);

  if (!assets.length) {
    add(root, h('div.card', h('div.empty', h('p', 'No investments yet.'), h('p.small', 'Add shares, mutual funds, SIPs, gold, crypto, FDs, PPF or NPS. Each one keeps its purchases (lots), so profit and tax are worked out for you.'), h('button.btn.primary', { onclick: () => openAssetForm() }, '+ Add your first investment'))));
    return;
  }
  const byType = new Map();
  for (const v of open) { const k = v.asset.type; if (!byType.has(k)) byType.set(k, []); byType.get(k).push(v); }
  for (const [type, list] of [...byType].sort((a, b) => Object.keys(ASSET_TYPES).indexOf(a[0]) - Object.keys(ASSET_TYPES).indexOf(b[0]))) {
    const T = ASSET_TYPES[type] || ASSET_TYPES.other;
    const sum = list.reduce((s, v) => ({ cost: s.cost + v.cost, value: s.value + v.value }), { cost: 0, value: 0 });
    add(root, h('div.section-h', h('h2', T.name), h('span.muted.small', money(sum.value) + ' · gain ' + money(sum.value - sum.cost, { sign: true }))),
      h('div.card', h('div.tbl-wrap', h('table.tbl',
        h('thead', h('tr', h('th', 'Name'), T.units ? h('th.r', 'Quantity') : null, T.units ? h('th.r.hide-sm', 'Avg cost') : null, h('th.r', 'Invested'), T.units ? h('th.r.hide-sm', 'Price') : null, h('th.r', 'Worth'), h('th.r', 'Gain'), T.units ? h('th.r.hide-sm', 'Long-term') : null)),
        h('tbody', list.sort((a, b) => b.value - a.value).map(v => h('tr.click', { onclick: () => go('asset', v.asset.id) },
          h('td', v.asset.name, v.asset.symbol ? h('div.narr', v.asset.symbol) : null, v.fifo && v.fifo.pendingCount ? h('span.pill.warn', v.fifo.pendingCount + ' without units') : null, v.asset.closed ? h('span.pill', 'closed') : null),
          T.units ? h('td.r', fmtQty(v.qty, v.asset)) : null,
          T.units ? h('td.r.amt.hide-sm', v.qty ? money(Math.round(v.fifo.avg)) : '') : null,
          h('td.r.amt', money(v.cost)),
          T.units ? h('td.r.hide-sm', v.priced ? money(v.asset.price) : h('span.muted.small', 'not set'), v.asset.priceDate ? h('div.narr', fmtDate(v.asset.priceDate)) : null) : null,
          h('td.r.amt', money(v.value)),
          h('td.r', amt(v.value - v.cost, { flow: true }), h('div.narr', pct(v.value - v.cost, v.cost))),
          T.units ? h('td.r.hide-sm.small', v.qty ? (v.ltQty >= v.qty - 1e-9 ? 'all' : v.ltQty > 0 ? fmtQty(v.ltQty, v.asset) : '—') : '') : null)))))));
  }
}
function kpi(lbl, val, foot) { return h('div.card.kpi', h('div.lbl', lbl), h('div.val', { style: { fontSize: '19px' } }, val), foot ? h('div.foot', foot) : null); }

/* pending SIP units, sales needing recalculation, money not linked to any investment, overselling */
function alerts(root, c, assets, vals) {
  const notes = [];
  const pending = vals.filter(v => v.fifo && v.fifo.pendingCount);
  if (pending.length) notes.push(h('div.note.warn', pending.reduce((s, v) => s + v.fifo.pendingCount, 0) + ' purchase(s) are waiting for the number of units (usually SIP instalments). ', h('a', { href: '#', onclick: ev => { ev.preventDefault(); openPendingUnits(); } }, 'Enter units')));
  const stale = staleSales(c);
  if (stale.length) notes.push(h('div.note.warn', stale.length + ' sale(s) need recalculating because an earlier purchase changed. ', h('a', { href: '#', onclick: async ev => { ev.preventDefault(); await recalcSales(stale); } }, 'Recalculate now')));
  for (const v of vals) for (const p of (v.fifo && v.fifo.problems) || []) notes.push(h('div.note.bad', v.asset.name + ': ' + p.text + ' Add the missing purchase or opening holding.'));
  for (const u of unlinked(c, assets, vals)) {
    if (!u.books && !u.linked) continue;
    notes.push(h('div.note', h('b', ledgerName(u.ledger)), u.diff > 0
      ? ` has ${money(u.diff)} not linked to any investment (for example a starting balance). Use “+ Add investment” for what it holds — past purchases go under “Already own some”, an FD / PPF balance under “Amount already in it” — so gains can be worked out.`
      : ` — investments listed here cost ${money(-u.diff)} more than the account shows. `,
    u.diff < 0 ? h('a', { href: '#', onclick: async ev => { ev.preventDefault(); await store.saveLedger({ ...u.ledger, opening: (u.ledger.opening || 0) - u.diff }); toast('Starting balance updated'); } }, 'Add the difference to its starting balance') : null));
  }
  if (notes.length) add(root, h('div.cards', { style: { marginBottom: '14px' } }, notes));
}

/* ======================= one investment ======================= */
export function renderAsset(root, id) {
  const a = store.asset(id);
  const c = store.ctx();
  if (!a || a.entityId !== c.entity.id) { add(root, h('div.empty', 'Investment not found for this person. ', h('a', { href: '#/portfolio' }, 'Portfolio'))); return; }
  const T = typeOf(a);
  const v = valueAsset(a, c.vouchers);
  const txns = assetTxns(c.vouchers, a.id).slice().reverse();
  add(root, h('div.toolbar', h('a.btn.sm', { href: '#/portfolio' }, '← Portfolio'), h('span.muted', T.name + ' · ' + ledgerName(c.lById.get(a.ledgerId))), h('span.spacer'),
    T.units ? [h('button.btn.sm.primary', { onclick: () => openBuy(a.id) }, 'Buy'), h('button.btn.sm', { onclick: () => openSell(a.id), disabled: !(v.qty > 0) }, 'Sell'), h('button.btn.sm', { onclick: () => openIncome(a.id) }, a.type === 'crypto' ? 'Income' : 'Dividend'), h('button.btn.sm', { onclick: () => openPrice(a) }, 'Price'), h('button.btn.sm', { onclick: () => openEvent(a) }, 'Split / bonus')]
      : [h('button.btn.sm.primary', { onclick: () => openDeposit(a.id) }, 'Add money'), h('button.btn.sm', { onclick: () => openIncome(a.id) }, 'Interest'), h('button.btn.sm', { onclick: () => openWithdraw(a.id), disabled: a.closed }, a.type === 'fd' ? 'Close / withdraw' : 'Withdraw'), h('button.btn.sm', { onclick: () => openPrice(a) }, 'Value')],
    h('button.btn.sm', { onclick: () => openAssetForm(a) }, 'Edit')));
  add(root, h('div.kpis',
    T.units ? kpi('Holding', fmtQty(v.qty, a) + ' ' + (T.unit || ''), v.qty ? 'avg ' + money(Math.round(v.fifo.avg)) : '') : kpi('In it (book value)', amt(v.cost)),
    kpi('Invested', amt(v.cost)), kpi('Worth today', amt(v.value), a.priceDate || a.valueDate ? 'as on ' + fmtDate(a.priceDate || a.valueDate) : (T.units && !v.priced ? 'price not set — showing cost' : a.type === 'fd' ? 'estimated with interest' : '')),
    kpi('Gain', amt(v.value - v.cost, { flow: true }), pct(v.value - v.cost, v.cost))));
  if (a.type === 'fd' && a.fd) add(root, h('div.note', `FD of ${money(a.fd.principal || 0)} at ${a.fd.rate || 0}% from ${fmtDate(a.fd.start)}${a.fd.maturity ? ' to ' + fmtDate(a.fd.maturity) : ''}${a.fd.payout === 'payout' ? ' · interest paid out' : ' · interest added to the FD'}.`));
  if (a.note) add(root, h('p.note', a.note));
  if (T.units) {
    const rules = rulesFor(fyOf(today()));
    const lots = v.fifo.lots;
    add(root, h('div.section-h', h('h2', 'What I hold (purchase lots)'), h('span.muted.small', 'oldest is sold first')),
      h('div.card', lots.length ? h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Bought on'), h('th.r', 'Quantity'), h('th.r', 'Cost'), h('th.r', 'Per unit'), h('th.r', 'Worth now'), h('th', 'Long-term from'))),
        h('tbody', lots.map(l => {
          const ltFrom = T.cls === 'vda' ? 'flat 30%' : T.cls === 'debt_mf' && l.date >= '2023-04-01' ? 'never (debt fund)' : (() => { const r = rules[T.cls]; const m = T.cls === 'debt_mf' ? r.oldLtMonths : r.ltMonths; return m ? fmtDate(addMonths(l.date, m)) : ''; })();
          const isLong = termOf(T.cls, rules, l.date, today()) === 'long';
          return h('tr', h('td', fmtDate(l.date), l.src === 'opening' ? h('span.pill', { style: { marginLeft: '6px' } }, 'already owned') : l.src === 'bonus' ? h('span.pill', { style: { marginLeft: '6px' } }, 'bonus') : null),
            h('td.r', fmtQty(l.qty, a)), h('td.r.amt', money(l.cost)), h('td.r.amt', money(Math.round(l.cost / l.qty))), h('td.r.amt', v.priced ? money(Math.round(l.qty * a.price)) : ''),
            h('td', isLong ? h('span.pill.ok', 'long-term now') : ltFrom));
        })))) : h('div.empty', 'Nothing held.')));
    const real = v.fifo.realised.map(s => classify(a, s)).reverse();
    if (real.length) add(root, h('div.section-h', h('h2', 'Profit / loss on sales')), h('div.card', h('div.tbl-wrap', h('table.tbl',
      h('thead', h('tr', h('th', 'Sold on'), h('th', 'Bought on'), h('th.r', 'Quantity'), h('th.r', 'Cost'), h('th.r', 'Sale value'), h('th.r', 'Profit'), h('th', 'Type'))),
      h('tbody', real.map(r => h('tr', h('td', fmtDate(r.sellDate)), h('td', fmtDate(r.buyDate)), h('td.r', fmtQty(r.qty, a)), h('td.r.amt', money(r.cost)), h('td.r.amt', money(r.proceeds)), h('td.r', amt(r.gain, { flow: true })),
        h('td', h('span.pill', r.term === 'flat' ? 'crypto 30%' : r.term === 'long' ? 'long term' : 'short term')))))))));
  }
  add(root, h('div.section-h', h('h2', 'Entries')), h('div.card', txns.length ? h('table.tbl', h('tbody', txns.map(x => {
    const m = x.meta.inv;
    const label = { buy: 'Bought', sell: 'Sold', dividend: 'Dividend', interest: m.reinvested ? 'Interest added' : 'Interest received', deposit: 'Money added', withdraw: 'Withdrawn' }[m.action] || m.action;
    const tot = x.lines.reduce((s, l) => s + l.dr, 0);
    return h('tr.click', { onclick: () => import('./entry.js').then(mm => mm.openVoucher(x.id)) }, h('td.nowrap', fmtDate(x.date)), h('td', label, m.qty ? ' ' + fmtQty(m.qty, a) + ' ' + (T.unit || '') : '', m.action === 'buy' && !(m.qty > 0) && T.units ? h('span.pill.warn', ' units?') : null, x.narration ? h('div.narr', x.narration) : null), h('td.r.amt', money(m.action === 'sell' ? m.proceeds : m.cost || m.amount || tot)));
  }))) : h('div.empty', 'No entries yet.')));
}

/* ======================= add / edit investment ======================= */
export function openAssetForm(existing = null, preset = {}) {
  const e = store.activeEntity();
  const c = store.ctxOf(e.id);
  const a = existing ? clone(existing) : { id: uid('ast'), entityId: e.id, name: preset.name || '', type: preset.type || 'equity_mf', symbol: '', isin: '', schemeCode: '', coinId: '', ledgerId: '', price: 0, priceDate: '', openingLots: [], events: [], openingAmount: 0, fd: {}, note: '', archived: false, closed: false, createdAt: nowISO() };
  const name = h('input.inp', { value: a.name, placeholder: 'e.g. Parag Parikh Flexi Cap, HDFC Bank, SBI FD 2026', autofocus: true });
  const type = select(Object.entries(ASSET_TYPES).map(([k, x]) => ({ value: k, label: x.name })), a.type, { disabled: !!existing && (store.S.vouchers.some(v => v.meta && v.meta.inv && v.meta.inv.assetId === a.id) || (a.openingLots || []).length) });
  const symbol = h('input.inp', { value: a.symbol || '', placeholder: 'NSE symbol, e.g. HDFCBANK' });
  const isin = h('input.inp', { value: a.isin || '', placeholder: 'INE… (optional)' });
  const scheme = h('input.inp', { value: a.schemeCode || '', placeholder: 'AMFI scheme code (optional, for online NAV)' });
  const coin = h('input.inp', { value: a.coinId || '', placeholder: 'e.g. bitcoin, ethereum (optional, for online price)' });
  const price = amountInput(a.price || 0);
  const st = { ledgerId: a.ledgerId };
  const ledgerBox = h('div');
  const lots = (a.openingLots || []).map(l => ({ ...l }));
  const lotsBox = h('div');
  const opening = amountInput(a.openingAmount || 0);
  const fd = { principal: amountInput(a.fd && a.fd.principal), rate: h('input.inp', { type: 'number', step: '0.01', value: (a.fd && a.fd.rate) || '' }), start: dateInput((a.fd && a.fd.start) || ''), maturity: dateInput((a.fd && a.fd.maturity) || ''), payout: select([{ value: 'cumulative', label: 'Interest added to the FD' }, { value: 'payout', label: 'Interest paid out to bank' }], (a.fd && a.fd.payout) || 'cumulative') };
  const note = h('input.inp', { value: a.note || '', placeholder: 'optional' });
  const dyn = h('div.grid');
  const T = () => ASSET_TYPES[type.value];
  const drawLedger = () => {
    clear(ledgerBox);
    const items = ledgerItems(c, l => ['investment', 'fixed'].includes(c.natureOf(l)));
    const def = c.ledgers.find(l => !l.archived && l.name === T().ledger);
    if (!st.ledgerId || !items.some(i => i.id === st.ledgerId)) st.ledgerId = def ? def.id : '';
    add(ledgerBox, field('Kept in account', combo(items, st.ledgerId, id => { st.ledgerId = id; }, { placeholder: def ? '' : 'will create “' + T().ledger + '”' }), 'Groups similar investments for your records'));
  };
  const drawLots = () => {
    clear(lotsBox);
    if (!T().units) return;
    const tb = h('tbody');
    lots.forEach((l, i) => {
      const d = dateInput(l.date, { onchange: ev => { l.date = ev.target.value; drawLots(); } });
      const q = h('input.inp.sm', { type: 'number', step: 'any', min: 0, value: l.qty || '', oninput: ev => { l.qty = Number(ev.target.value); } });
      const cst = amountInput(l.cost, { class: 'sm', oninput: () => { l.cost = cst.paise(); } });
      const fmv = amountInput(l.fmv2018, { class: 'sm', oninput: () => { l.fmv2018 = fmv.paise(); } });
      add(tb, h('tr', h('td', d), h('td', q), h('td', cst), T().cls === 'equity' && l.date && l.date <= '2018-01-31' ? h('td', fmv) : h('td.muted.small', T().cls === 'equity' ? 'only for before Feb 2018' : ''), h('td', h('button.btn.ghost.icon.sm', { onclick: () => { lots.splice(i, 1); drawLots(); } }, '✕'))));
    });
    add(lotsBox, h('div.section-h', h('h2.small', 'Already own some?'), h('span.muted.small', 'one row per purchase you made before using this app')),
      lots.length ? h('table.lines', h('thead', h('tr', h('th', 'Bought on'), h('th', 'Quantity'), h('th', 'Total cost'), h('th', T().cls === 'equity' ? 'Value on 31 Jan 2018' : ''), h('th'))), tb) : null,
      h('button.btn.sm', { onclick: () => { lots.push({ id: uid('lot'), date: '', qty: 0, cost: 0, fmv2018: 0 }); drawLots(); } }, '+ Add a past purchase'),
      h('p.small.muted', 'The purchase date decides short or long term, so use the real date if you can (statements show it). These count as part of the account’s starting balance — no money moves now.'));
  };
  const drawDyn = () => {
    clear(dyn);
    const x = T();
    if (x.units) {
      add(dyn, h('div.grid.g3', a.type === 'crypto' || type.value === 'crypto' ? field('Coin id', coin) : field('Symbol', symbol), field('ISIN', isin), x.priceSrc === 'mf' ? field('Scheme code', scheme) : field('Current price per ' + (x.unit || 'unit').replace(/s$/, ''), price)));
      if (x.priceSrc === 'mf') add(dyn, h('div.grid.g3', field('Current NAV / price per unit', price)));
    } else {
      if (type.value === 'fd') add(dyn, h('div.grid.g3', field('Amount deposited', fd.principal), field('Interest rate % a year', fd.rate), field('Interest', fd.payout), field('Start date', fd.start), field('Maturity date', fd.maturity)));
      add(dyn, h('div.grid.g3', field('Amount already in it when I started', opening, 'part of the account’s starting balance')));
    }
    drawLedger(); drawLots();
  };
  type.addEventListener('change', () => { st.ledgerId = ''; drawDyn(); });
  drawDyn();
  const md = openModal({
    title: existing ? 'Edit investment' : 'Add investment', size: 'wide',
    body: h('div.grid', h('div.grid.g2', field('Name', name), field('Type', type, 'decides how tax is worked out')), dyn, ledgerBox, field('Note', note), lotsBox),
    foot: [existing ? h('button.btn.danger.left', { onclick: async () => { if (!(await confirmBox('Delete this investment?', 'Only possible when it has no entries.', 'Delete', true))) return; try { await store.deleteAsset(a.id); md.close(); toast('Deleted'); go('portfolio'); } catch (err) { toast(err.message); } } }, 'Delete') : null,
      h('button.btn', { onclick: () => md.close() }, 'Cancel'),
      h('button.btn.primary', { onclick: async () => {
        if (!name.value.trim()) return toast('Enter a name');
        const x = T();
        const badLot = lots.find(l => !isDate(l.date) || !(l.qty > 0) || !(l.cost >= 0));
        if (badLot) return toast('Each past purchase needs a date, quantity and cost');
        let ledgerId = st.ledgerId;
        if (!ledgerId) ledgerId = (await store.ensureLedgerNamed(e.id, x.fixed ? 'fixed' : 'invest', x.ledger)).id;
        const rec = { ...a, name: name.value.trim(), type: type.value, symbol: symbol.value.trim().toUpperCase(), isin: isin.value.trim().toUpperCase(), schemeCode: scheme.value.trim(), coinId: coin.value.trim().toLowerCase(), ledgerId, note: note.value.trim(),
          openingLots: x.units ? lots.map(l => ({ id: l.id || uid('lot'), date: l.date, qty: Number(l.qty), cost: l.cost || 0, fmv2018: l.fmv2018 || 0 })) : [],
          openingAmount: x.units ? 0 : opening.paise() };
        const p = price.paise();
        if (p && p !== a.price) { rec.price = p; rec.priceDate = today(); }
        if (type.value === 'fd') rec.fd = { principal: fd.principal.paise(), rate: Number(fd.rate.value) || 0, start: fd.start.value, maturity: fd.maturity.value, payout: fd.payout.value };
        await store.saveAsset(rec);
        md.close(); toast('Saved');
        if (!existing && preset.after) preset.after(rec); else if (!existing) go('asset', rec.id);
      } }, 'Save')]
  });
}

/* asset picker with "+ New investment" */
function assetCombo(entityId, value, onPick, filter = () => true) {
  const items = () => store.assetsOf(entityId).filter(a => !a.archived && filter(a)).map(a => ({ id: a.id, label: a.name, group: typeOf(a).name, alias: a.symbol || '' }));
  const cb = combo(items(), value, onPick, { onCreate: name => new Promise(res => openAssetForm(null, { name, after: a => res(a.id) })), refresh: items });
  return cb;
}

/* ======================= buy ======================= */
export function openBuy(assetId = '', existing = null) {
  const e = store.activeEntity();
  const c = store.ctxOf(e.id);
  const m0 = existing ? existing.meta.inv : {};
  const st = { assetId: existing ? m0.assetId : assetId, pay: existing ? existing.lines.find(l => l.cr).ledgerId : defaultPay(c), pending: existing ? !(m0.qty > 0) : false };
  const date = dateInput(existing ? existing.date : today());
  const qty = h('input.inp', { type: 'number', step: 'any', min: 0, value: existing && m0.qty ? m0.qty : '', placeholder: '0', oninput: () => sync('qty') });
  const price = amountInput(existing ? m0.price : 0, { oninput: () => sync('price') });
  const total = amountInput(existing ? m0.cost - (m0.charges || 0) : 0, { oninput: () => sync('total') });
  const charges = amountInput(existing ? m0.charges : 0, { oninput: refresh });
  const fmv = amountInput(existing ? m0.fmv2018 : 0);
  const note = h('input.inp', { value: existing ? existing.narration : '', placeholder: 'optional, e.g. SIP October' });
  const pendChk = h('input', { type: 'checkbox', checked: st.pending, onchange: ev => { st.pending = ev.target.checked; qty.disabled = st.pending; refresh(); } });
  qty.disabled = st.pending;
  const prev = h('div.vpreview');
  const unitLabel = h('span', 'Quantity');
  function sync(src) {
    const q = Number(qty.value) || 0, p = price.paise(), tt = total.paise();
    if (src === 'qty' || src === 'price') { if (q && p) total.value = (Math.round(q * p) / 100).toString(); }
    else if (src === 'total') { if (q && tt) price.value = (Math.round(tt / q) / 100).toString(); }
    refresh();
  }
  function refresh() {
    clear(prev);
    const a = store.asset(st.assetId);
    if (a) unitLabel.textContent = 'Quantity (' + (typeOf(a).unit || 'units') + ')';
    const cost = total.paise() + charges.paise();
    if (!a || !cost) return add(prev, h('span.muted', 'Pick the investment and amount.'));
    add(prev, h('div.ln', h('span', 'From ', h('b', ledgerName(c.lById.get(st.pay)))), h('span.amt', money(cost))), h('div.ln', h('span', '→ Into ', h('b', a.name), ' (', ledgerName(c.lById.get(a.ledgerId)), ')'), h('span.amt', money(cost))),
      !st.pending && Number(qty.value) ? h('div.small.muted', 'Cost per unit incl. charges: ' + money(Math.round(cost / Number(qty.value)))) : null);
  }
  const md = openModal({
    title: existing ? 'Edit purchase' : 'Buy / invest', size: 'wide',
    body: h('div.grid',
      h('div.grid.g2', field('Investment', assetCombo(e.id, st.assetId, id => { st.assetId = id; refresh(); }, a => typeOf(a).units)), field('Paid from', combo(payItems(c), st.pay, id => { st.pay = id; refresh(); }))),
      h('div.grid.g4', field(unitLabel, qty), field('Price per unit', price), field('Amount', total), field('Charges', charges, 'brokerage, stamp duty — added to cost')),
      h('div.grid.g4', field('Date', date), h('div.span2', field('Note', note)), h('label.check', { style: { alignSelf: 'end' } }, pendChk, h('span', 'Units not known yet', h('div.small.muted', 'e.g. SIP — fill in later')))),
      h('details', h('summary.small.muted', 'Bought before February 2018?'), field('Value on 31 Jan 2018 (listed shares / equity funds)', fmv, 'Used for the grandfathering rule in long-term gains')),
      prev),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: save }, 'Save')]
  });
  refresh();
  async function save() {
    const a = store.asset(st.assetId);
    if (!a) return toast('Pick the investment');
    if (!st.pay) return toast('Choose where the money came from');
    const q = st.pending ? 0 : Number(qty.value) || 0;
    const cost = total.paise() + charges.paise();
    if (!cost) return toast('Enter the amount');
    if (!st.pending && !(q > 0)) return toast('Enter the quantity, or tick “Units not known yet”');
    const draft = { type: 'payment', src: 'investment', date: date.value, narration: note.value.trim() || 'Bought ' + a.name, lines: tidyLines([{ ledgerId: a.ledgerId, dr: cost }, { ledgerId: st.pay, cr: cost }]),
      meta: { inv: { assetId: a.id, action: 'buy', qty: q, cost, price: price.paise(), charges: charges.paise(), fmv2018: fmv.paise() || 0 } } };
    draft.type = inferType(c, draft.lines);
    try {
      if (existing) await store.saveVoucher({ ...existing, ...draft });
      else await store.saveVoucher(newVoucher(e.id, draft));
      md.close(); toast(existing ? 'Updated' : 'Saved');
      const stale = staleSales(store.ctx()); if (stale.length) await recalcSales(stale, true);
    } catch (err) { toast(err.message); }
  }
}

/* ======================= sell ======================= */
export function openSell(assetId = '', existing = null) {
  const e = store.activeEntity();
  const c = store.ctxOf(e.id);
  const m0 = existing ? existing.meta.inv : {};
  const st = { assetId: existing ? m0.assetId : assetId, to: existing ? existing.lines.find(l => l.dr).ledgerId : defaultPay(c) };
  const date = dateInput(existing ? existing.date : today(), { onchange: () => refresh() });
  const qty = h('input.inp', { type: 'number', step: 'any', min: 0, value: existing ? m0.qty : '', oninput: () => sync('qty') });
  const price = amountInput(existing ? m0.price : 0, { oninput: () => sync('price') });
  const gross = amountInput(existing ? m0.gross : 0, { oninput: () => sync('gross') });
  const charges = amountInput(existing ? m0.charges : 0, { oninput: () => refresh() });
  const note = h('input.inp', { value: existing ? existing.narration : '', placeholder: 'optional' });
  const prev = h('div');
  const held = h('span.small.muted');
  function sync(src) {
    const q = Number(qty.value) || 0, p = price.paise(), g = gross.paise();
    if (src === 'qty' || src === 'price') { if (q && p) gross.value = (Math.round(q * p) / 100).toString(); }
    else if (src === 'gross') { if (q && g) price.value = (Math.round(g / q) / 100).toString(); }
    refresh();
  }
  function plan() {
    const a = store.asset(st.assetId);
    if (!a) return null;
    const q = Number(qty.value) || 0, net = gross.paise() - charges.paise();
    if (!(q > 0) || !gross.paise()) return { a };
    const keys = {};
    const r = saleLines({ asset: a, vouchers: store.ctx().vouchers, sellRef: existing ? existing.id : '', date: date.value, qty: q, proceeds: net, moneyLedgerId: st.to, investLedgerId: a.ledgerId, gainLedgerFor: k => (keys[k] = k) });
    return { a, q, net, ...r, keys: Object.keys(keys) };
  }
  function refresh() {
    clear(prev);
    const a = store.asset(st.assetId);
    if (a) { const f = fifo(a, store.ctx().vouchers.filter(v => !existing || v.id !== existing.id), { upto: date.value }); held.textContent = 'You hold ' + fmtQty(f.qty, a) + ' ' + (typeOf(a).unit || '') + ' on this date'; held.dataset.qty = f.qty; }
    const p = plan();
    if (!p || !p.slices) return add(prev, h('div.vpreview.muted', 'Pick the investment, quantity and sale value.'));
    if (p.problem) add(prev, h('div.note.bad', p.problem));
    add(prev, h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'From purchase of'), h('th.r', 'Qty'), h('th.r', 'Cost'), h('th.r', 'Sale value'), h('th.r', 'Profit'), h('th', 'Type'))),
      h('tbody', p.slices.map(s => h('tr', h('td', fmtDate(s.buyDate)), h('td.r', fmtQty(s.qty, p.a)), h('td.r.amt', money(s.cost)), h('td.r.amt', money(s.proceeds)), h('td.r', amt(s.gain, { flow: true })), h('td', h('span.pill', s.term === 'flat' ? 'crypto 30%' : s.term === 'long' ? 'long term' : 'short term'))))),
      h('tfoot', h('tr', h('td', 'Total'), h('td.r', fmtQty(p.q, p.a)), h('td.r.amt', money(p.cost)), h('td.r.amt', money(p.net)), h('td.r', amt(p.gain, { flow: true })), h('td'))))),
    h('p.small.muted', 'Oldest units are sold first (FIFO). Charges reduce the sale value.' + (typeOf(p.a).cls === 'vda' ? ' Crypto: taxed at 30% and a loss cannot reduce other income. 1% TDS is usually cut by the exchange.' : '')));
  }
  const md = openModal({
    title: existing ? 'Edit sale' : 'Sell / redeem', size: 'wide',
    body: h('div.grid',
      h('div.grid.g2', field('Investment', assetCombo(e.id, st.assetId, id => { st.assetId = id; refresh(); }, a => typeOf(a).units)), field('Money received in', combo(payItems(c), st.to, id => { st.to = id; refresh(); }))),
      h('div.grid.g4', field(h('span', 'Quantity ', h('a', { href: '#', onclick: ev => { ev.preventDefault(); qty.value = held.dataset.qty || ''; sync('qty'); } }, '(all)')), qty), field('Price per unit', price), field('Sale value', gross), field('Charges', charges, 'brokerage, STT')),
      held,
      h('div.grid.g4', field('Date', date), h('div.span3', field('Note', note))),
      prev),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: save }, 'Save')]
  });
  refresh();
  async function save() {
    const p = plan();
    if (!p || !p.a) return toast('Pick the investment');
    if (!p.slices) return toast('Enter quantity and sale value');
    if (p.problem) return toast(p.problem);
    if (!st.to) return toast('Choose where the money went');
    const ids = {};
    for (const k of p.keys) ids[k] = (await store.ensureGainLedger(e.id, k)).id;
    const lines = tidyLines(p.lines.map(l => (ids[l.ledgerId] ? { ...l, ledgerId: ids[l.ledgerId] } : l)));
    const draft = { type: inferType(store.ctxOf(e.id), lines), src: 'investment', date: date.value, narration: note.value.trim() || 'Sold ' + p.a.name, lines,
      meta: { inv: { assetId: p.a.id, action: 'sell', qty: p.q, proceeds: p.net, gross: gross.paise(), charges: charges.paise(), price: price.paise() } } };
    try {
      if (existing) await store.saveVoucher({ ...existing, ...draft });
      else await store.saveVoucher(newVoucher(e.id, draft));
      md.close(); toast('Saved · profit ' + money(p.gain, { sign: true }));
      const stale = staleSales(store.ctx()); if (stale.length) await recalcSales(stale, true);
    } catch (err) { toast(err.message); }
  }
}

/* A sale's posted cost goes stale if an earlier purchase is added, changed or deleted. */
export function staleSales(c) {
  const out = [];
  for (const v of c.vouchers) {
    const m = v.meta && v.meta.inv; if (!m || m.action !== 'sell') continue;
    const a = store.asset(m.assetId); if (!a) continue;
    const r = saleLines({ asset: a, vouchers: c.vouchers, sellRef: v.id, date: v.date, qty: m.qty, proceeds: m.proceeds, moneyLedgerId: '', investLedgerId: a.ledgerId, gainLedgerFor: k => k });
    if (r.problem) continue; /* overselling is reported separately */
    const posted = v.lines.filter(l => l.ledgerId === a.ledgerId).reduce((s, l) => s + l.cr - l.dr, 0);
    if (posted !== r.cost) out.push(v);
  }
  return out;
}
async function recalcSales(list, quiet = false) {
  let n = 0;
  for (const v of list.sort((x, y) => x.date.localeCompare(y.date))) {
    const c = store.ctxOf(v.entityId);
    const m = v.meta.inv; const a = store.asset(m.assetId);
    const money0 = v.lines.find(l => l.dr && l.ledgerId !== a.ledgerId && !(c.lById.get(l.ledgerId) || {}).system) || v.lines.find(l => l.dr);
    const r = saleLines({ asset: a, vouchers: c.vouchers, sellRef: v.id, date: v.date, qty: m.qty, proceeds: m.proceeds, moneyLedgerId: money0.ledgerId, investLedgerId: a.ledgerId, gainLedgerFor: k => k });
    if (r.problem) continue;
    const ids = {};
    for (const l of r.lines) if (!c.lById.has(l.ledgerId) && l.ledgerId !== money0.ledgerId && l.ledgerId !== a.ledgerId) ids[l.ledgerId] = (await store.ensureGainLedger(v.entityId, l.ledgerId)).id;
    const lines = tidyLines(r.lines.map(l => (ids[l.ledgerId] ? { ...l, ledgerId: ids[l.ledgerId] } : l)));
    try { await store.saveVoucher({ ...v, lines }); n++; } catch (err) { toast(err.message); return; }
  }
  if (!quiet || n) toast(n + ' sale(s) recalculated');
}

/* SIP instalments saved without units */
function openPendingUnits() {
  const c = store.ctx();
  const rows = c.vouchers.filter(v => v.meta && v.meta.inv && v.meta.inv.action === 'buy' && !(v.meta.inv.qty > 0) && typeOf(store.asset(v.meta.inv.assetId) || {}).units).sort((a, b) => a.date.localeCompare(b.date));
  const inputs = rows.map(v => h('input.inp.sm', { type: 'number', step: 'any', min: 0, placeholder: 'units' }));
  const md = openModal({
    title: 'Enter units', sub: 'From the fund’s statement or SMS / email confirmation.', size: 'wide',
    body: h('table.tbl', h('thead', h('tr', h('th', 'Date'), h('th', 'Investment'), h('th.r', 'Amount'), h('th', 'Units'))), h('tbody', rows.map((v, i) => h('tr', h('td', fmtDate(v.date)), h('td', (store.asset(v.meta.inv.assetId) || {}).name), h('td.r.amt', money(v.meta.inv.cost)), h('td', inputs[i]))))),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: async () => {
      let n = 0;
      for (let i = 0; i < rows.length; i++) { const q = Number(inputs[i].value); if (q > 0) { const v = rows[i]; await store.saveVoucher({ ...v, meta: { ...v.meta, inv: { ...v.meta.inv, qty: q, price: Math.round(v.meta.inv.cost / q) } } }); n++; } }
      md.close(); toast(n + ' updated');
      const stale = staleSales(store.ctx()); if (stale.length) await recalcSales(stale, true);
    } }, 'Save')]
  });
}

/* ======================= income on an investment ======================= */
export function openIncome(assetId = '') {
  const e = store.activeEntity();
  const c = store.ctxOf(e.id);
  const reinvestDefault = a => !!(a && (a.type === 'ppf' || a.type === 'nps' || (a.type === 'fd' && (a.fd || {}).payout !== 'payout')));
  const st = { assetId, to: defaultPay(c), reinvest: reinvestDefault(store.asset(assetId)) };
  const amount = amountInput(0), tds = amountInput(0);
  const date = dateInput(today());
  const note = h('input.inp', { placeholder: 'optional' });
  const reBox = h('label.check');
  const drawRe = () => {
    clear(reBox);
    const a = store.asset(st.assetId);
    if (a && !typeOf(a).units) add(reBox, h('input', { type: 'checkbox', checked: st.reinvest, onchange: ev => { st.reinvest = ev.target.checked; } }), h('span', 'Added to the ' + typeOf(a).name + ' (not paid out)', h('div.small.muted', 'e.g. FD cumulative interest, PPF yearly interest')));
  };
  const md = openModal({
    title: 'Dividend / interest',
    body: h('div.grid', field('Investment', assetCombo(e.id, st.assetId, id => { st.assetId = id; st.reinvest = reinvestDefault(store.asset(id)); drawRe(); })),
      h('div.grid.g3', field('Amount received (before TDS)', amount), field('TDS cut', tds), field('Date', date)), reBox,
      field('Received in', combo(payItems(c), st.to, id => { st.to = id; })), field('Note', note)),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: save }, 'Save')]
  });
  drawRe();
  async function save() {
    const a = store.asset(st.assetId);
    if (!a) return toast('Pick the investment');
    const gross = amount.paise(), t2 = tds.paise();
    if (!gross) return toast('Enter the amount');
    const T = typeOf(a);
    let inc;
    if (T.units) inc = (c.ledgers.find(l => l.taxTag === 'dividend' && !l.archived) || await store.ensureGainLedger(e.id, 'inv_income')).id;
    else if (a.type === 'fd') inc = (c.ledgers.find(l => l.name === 'Interest – FD') || await store.ensureGainLedger(e.id, 'inv_income')).id;
    else if (a.type === 'ppf') inc = (c.ledgers.find(l => l.name === 'PPF Interest') || await store.ensureLedgerNamed(e.id, 'othinc', 'PPF Interest', { taxTag: 'exempt' })).id;
    else inc = (await store.ensureGainLedger(e.id, 'inv_income')).id;
    const tdsL = c.ledgers.find(l => l.taxTag === 'tds_receivable');
    const into = st.reinvest ? a.ledgerId : st.to;
    if (!into) return toast('Choose where it was received');
    const lines = tidyLines([{ ledgerId: into, dr: gross - t2 }, t2 ? { ledgerId: tdsL.id, dr: t2 } : null, { ledgerId: inc, cr: gross }].filter(Boolean));
    const action = T.units ? 'dividend' : 'interest';
    const draft = { type: st.reinvest ? 'journal' : 'receipt', src: 'investment', date: date.value, narration: note.value.trim() || (action === 'dividend' ? 'Dividend – ' : 'Interest – ') + a.name, lines,
      meta: { inv: { assetId: a.id, action, amount: gross - t2, reinvested: st.reinvest } } };
    try { await store.saveVoucher(newVoucher(e.id, draft)); md.close(); toast('Saved'); } catch (err) { toast(err.message); }
  }
}

/* ======================= deposits: FD / PPF / NPS ======================= */
export function openDeposit(assetId) {
  const e = store.activeEntity(); const c = store.ctxOf(e.id); const a = store.asset(assetId);
  const st = { from: defaultPay(c) };
  const amount = amountInput(0), date = dateInput(today());
  const md = openModal({
    title: 'Add money to ' + a.name,
    body: h('div.grid', h('div.grid.g2', field('Amount', amount), field('Date', date)), field('Paid from', combo(payItems(c), st.from, id => { st.from = id; })),
      a.type === 'ppf' ? h('p.small.muted', 'PPF deposits count for the 80C deduction under the old tax regime.') : null),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: async () => {
      const v = amount.paise(); if (!v || !st.from) return toast('Enter amount and account');
      const lines = tidyLines([{ ledgerId: a.ledgerId, dr: v }, { ledgerId: st.from, cr: v }]);
      try { await store.saveVoucher(newVoucher(e.id, { type: inferType(c, lines), src: 'investment', date: date.value, narration: 'Deposit – ' + a.name, lines, meta: { inv: { assetId: a.id, action: 'deposit', amount: v } } })); md.close(); toast('Saved'); } catch (err) { toast(err.message); }
    } }, 'Save')]
  });
}
export function openWithdraw(assetId) {
  const e = store.activeEntity(); const c = store.ctxOf(e.id); const a = store.asset(assetId);
  const d = depositState(a, c.vouchers);
  const st = { to: defaultPay(c), close: a.type === 'fd' };
  const amount = amountInput(0), principal = amountInput(0), date = dateInput(today());
  const closeChk = h('input', { type: 'checkbox', checked: st.close, onchange: ev => { st.close = ev.target.checked; pWrap.classList.toggle('hide', st.close); } });
  const pWrap = h('div', field('Of which your own money (principal)', principal, 'the rest is treated as interest'));
  pWrap.classList.toggle('hide', st.close);
  const md = openModal({
    title: (a.type === 'fd' ? 'Close / withdraw – ' : 'Withdraw – ') + a.name, sub: 'In it now (book value): ' + money(d.book),
    body: h('div.grid', h('div.grid.g2', field('Amount received', amount), field('Date', date)), field('Received in', combo(payItems(c), st.to, id => { st.to = id; })),
      h('label.check', closeChk, 'Closing it completely'), pWrap),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: async () => {
      const got = amount.paise(); if (!got || !st.to) return toast('Enter amount and account');
      const cost = st.close ? d.book : Math.min(principal.paise() || got, d.book);
      const interest = got - cost;
      const incL = a.type === 'fd' ? (c.ledgers.find(l => l.name === 'Interest – FD') || await store.ensureGainLedger(e.id, 'inv_income')) : a.type === 'ppf' ? (c.ledgers.find(l => l.name === 'PPF Interest') || await store.ensureLedgerNamed(e.id, 'othinc', 'PPF Interest', { taxTag: 'exempt' })) : await store.ensureGainLedger(e.id, 'inv_income');
      const lines = tidyLines([{ ledgerId: st.to, dr: got }, { ledgerId: a.ledgerId, cr: cost }, interest > 0 ? { ledgerId: incL.id, cr: interest } : interest < 0 ? { ledgerId: incL.id, dr: -interest } : null].filter(Boolean));
      try {
        await store.saveVoucher(newVoucher(e.id, { type: inferType(store.ctxOf(e.id), lines), src: 'investment', date: date.value, narration: (st.close ? 'Closed – ' : 'Withdrawal – ') + a.name, lines, meta: { inv: { assetId: a.id, action: 'withdraw', amount: got, cost } } }));
        if (st.close) await store.saveAsset({ ...a, closed: true });
        md.close(); toast('Saved' + (interest > 0 ? ' · interest ' + money(interest) : ''));
      } catch (err) { toast(err.message); }
    } }, 'Save')]
  });
}

/* ======================= price / value, split / bonus ======================= */
function openPrice(a) {
  const T = typeOf(a);
  const v = amountInput(T.units ? a.price : a.value);
  const d = dateInput(today());
  const md = openModal({
    title: (T.units ? 'Price – ' : 'Current value – ') + a.name,
    body: h('div.grid.g2', field(T.units ? 'Price per ' + (T.unit || 'unit').replace(/s$/, '') : 'Value today', v, T.units ? '' : 'leave 0 to use ' + (a.type === 'fd' ? 'the interest estimate' : 'the book value')), field('As on', d)),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: async () => {
      const p = v.paise();
      await store.saveAsset(T.units ? { ...a, price: p, priceDate: d.value, priceSource: 'manual' } : { ...a, value: p, valueDate: p ? d.value : '' });
      md.close(); toast('Saved');
    } }, 'Save')]
  });
}
function openEvent(a) {
  const kind = select([{ value: 'split', label: 'Split (e.g. 1 share became 5)' }, { value: 'bonus', label: 'Bonus (e.g. 1 free for every 1 held)' }], 'split');
  const ratio = h('input.inp', { type: 'number', step: 'any', min: 0, placeholder: 'split: 5 · bonus 1:1 → 1' });
  const d = dateInput(today());
  const list = h('div.small');
  for (const ev of a.events || []) add(list, h('div', fmtDate(ev.date) + ' · ' + ev.type + ' ' + ev.ratio, ' ', h('a', { href: '#', onclick: async x => { x.preventDefault(); await store.saveAsset({ ...a, events: a.events.filter(z => z.id !== ev.id) }); md.close(); toast('Removed'); } }, 'remove')));
  const md = openModal({
    title: 'Split / bonus – ' + a.name,
    body: h('div.grid', h('div.grid.g3', field('What happened', kind), field('Ratio', ratio), field('Date', d)), h('p.small.muted', 'Split: quantity multiplies, cost stays the same. Bonus: new shares at zero cost, dated on the allotment day.'), list),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: async () => {
      const r = Number(ratio.value); if (!(r > 0) || !isDate(d.value)) return toast('Enter ratio and date');
      await store.saveAsset({ ...a, events: [...(a.events || []), { id: uid('evt'), type: kind.value, ratio: r, date: d.value }] });
      md.close(); toast('Saved');
      const stale = staleSales(store.ctx()); if (stale.length) await recalcSales(stale, true);
    } }, 'Save')]
  });
}

/* ======================= prices page (manual, optional online) ======================= */
export function renderPrices(root) {
  const e = store.activeEntity();
  const c = store.ctx();
  const list = store.assetsOf(e.id).filter(a => !a.archived && typeOf(a).units && valueAsset(a, c.vouchers).qty > 0);
  if (!list.length) { add(root, h('div.empty', 'No investments with units held.')); return; }
  const inputs = list.map(a => amountInput(a.price));
  const status = list.map(() => h('span.small.muted'));
  const date = dateInput(today());
  add(root, h('p.muted', { style: { marginTop: 0 } }, 'Prices are entered by you, so the app works offline. Zerodha holdings import also updates share prices.'),
    h('div.card', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Investment'), h('th', 'Last price'), h('th', 'New price'), h('th'))),
      h('tbody', list.map((a, i) => h('tr', h('td', a.name, h('div.narr', typeOf(a).name)), h('td', a.price ? money(a.price) + ' · ' + fmtDate(a.priceDate) : h('span.muted', 'not set')), h('td', { style: { width: '180px' } }, inputs[i]), h('td', status[i]))))))),
    h('div.btnrow', { style: { marginTop: '10px' } }, field('Prices as on', date),
      S.settings.onlinePrices ? h('button.btn', { style: { alignSelf: 'end' }, onclick: fetchOnline }, '⟳ Fetch mutual fund NAV & crypto prices') : h('span.small.muted', { style: { alignSelf: 'end' } }, 'Online fetch for mutual funds and crypto can be switched on in Settings.'),
      h('span.spacer'), h('button.btn.primary', { style: { alignSelf: 'end' }, onclick: saveAll }, 'Save prices')));
  async function saveAll() {
    const ops = [];
    list.forEach((a, i) => { const p = inputs[i].paise(); if (p && p !== a.price) ops.push({ store: 'assets', put: { ...a, price: p, priceDate: date.value, priceSource: inputs[i].dataset.src || 'manual', updatedAt: nowISO() } }); });
    if (!ops.length) return toast('No changes');
    await store.commit(ops); toast(ops.length + ' price(s) saved');
  }
  async function fetchOnline() {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      try {
        let p = null;
        if (a.schemeCode && typeOf(a).priceSrc === 'mf') {
          const r = await fetch('https://api.mfapi.in/mf/' + encodeURIComponent(a.schemeCode) + '/latest'); const j = await r.json();
          p = toPaise(j && j.data && j.data[0] && j.data[0].nav);
        } else if (a.coinId && a.type === 'crypto') {
          const r = await fetch('https://api.coingecko.com/api/v3/simple/price?vs_currencies=inr&ids=' + encodeURIComponent(a.coinId)); const j = await r.json();
          p = toPaise(j && j[a.coinId] && j[a.coinId].inr);
        } else { status[i].textContent = 'manual only'; continue; }
        if (p) { inputs[i].value = (p / 100).toString(); inputs[i].dataset.src = 'online'; status[i].textContent = '✓ fetched'; } else status[i].textContent = 'not found';
      } catch (err) { status[i].textContent = 'offline / blocked'; }
    }
    toast('Check the prices, then Save');
  }
}

/* ======================= capital gains ======================= */
export function renderGains(root) {
  const e = store.activeEntity();
  const c = store.ctx();
  const out = h('div');
  const exp = h('span.btnrow');
  add(root, h('div.toolbar', periodControl(draw), h('span.spacer'), exp), out);
  function draw() {
    const fy = period.mode === 'fy' ? currentPeriod().fy : fyOf(currentPeriod().to);
    const cg = capitalGains(store.assetsOf(e.id), c.vouchers, fy);
    const rules = rulesFor(fy);
    clear(out); clear(exp);
    const b = cg.buckets;
    const row = (label, v, cls = '', hint = '') => h('div.stmt-row' + (cls ? '.' + cls : ''), h('span', label, hint ? h('span.muted.small', '  ' + hint) : null), h('span', amt(v, { flow: v < 0 })));
    add(out, h('div.print-head', h('h2', 'Capital gains · tax year ' + fy), h('div', e.name)),
      h('div.stmt',
        h('div.card', h('div.card-h', h('h3', t('Profit on selling investments', 'Capital gains')), h('span.sub', 'tax year ' + fy)), h('div.card-b',
          row(t('Shares & equity funds — short term', 'STCG – listed equity (' + (fy >= '2026-27' ? 'Act 2025' : '111A') + ')'), b.eqST, '', '20%'),
          row(t('Shares & equity funds — long term', 'LTCG – listed equity (' + (fy >= '2026-27' ? 'Act 2025' : '112A') + ')'), b.eqLT, '', '12.5% above ₹1.25 lakh'),
          row(t('Other investments — short term', 'STCG – other (slab)'), b.othST, '', 'added to income, your slab rate'),
          row(t('Other investments — long term', 'LTCG – other (12.5%, no indexation)'), b.othLT, '', '12.5%'),
          row(t('Crypto — profits', 'VDA income (30%)'), b.vda, '', '30%'),
          b.vdaLoss ? row(t('Crypto — losses (cannot be used)', 'VDA losses (no set-off / carry forward)'), b.vdaLoss, '', 'ignored for tax') : null)),
        h('div.card', h('div.card-h', h('h3', 'Tax estimate on these profits')), h('div.card-b',
          row('After setting losses against profits — equity long term', cg.afterSetoff.eqLT), row('Tax-free long-term allowance used', -cg.exempt),
          row('Tax on equity short term', cg.tax.eqST, '', '20%'), row('Tax on equity long term', cg.tax.eqLT, '', '12.5%'), row('Tax on other long term', cg.tax.othLT, '', '12.5%'), row('Tax on crypto', cg.tax.vda, '', '30%'),
          row('Estimated tax (plus 4% cess and any surcharge)', cg.taxSpecial, 'tot'),
          cg.afterSetoff.othST ? h('p.small.muted', money(cg.afterSetoff.othST) + ' of short-term profit on other investments is added to your income and taxed at your slab rate.') : null,
          cg.carryForward.shortTerm || cg.carryForward.longTerm ? h('div.note', 'Losses to carry forward (up to 8 years, file the return on time): short term ' + money(cg.carryForward.shortTerm) + ', long term ' + money(cg.carryForward.longTerm) + '.') : null,
          h('p.small.muted', 'Estimate only. Holding periods for gold, unlisted shares and debt funds, and whether the rebate applies to these profits, are still to be confirmed with your CA (blueprint open item). The full tax computation comes in Phase 3.')))));
    const rows = cg.rows;
    add(out, h('div.section-h', h('h2', 'Every sale'), h('span.muted.small', rows.length + ' line(s)')),
      h('div.card', rows.length ? h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Investment'), h('th', 'Bought'), h('th', 'Sold'), h('th.r', 'Qty'), h('th.r', 'Cost'), h('th.r', 'Sale value'), h('th.r', 'Profit'), h('th', 'Type'))),
        h('tbody', rows.map(r => h('tr.click', { onclick: () => go('asset', r.asset.id) }, h('td', r.asset.name, r.asset.isin ? h('div.narr', r.asset.isin) : null), h('td', fmtDate(r.buyDate)), h('td', fmtDate(r.sellDate)), h('td.r', fmtQty(r.qty, r.asset)),
          h('td.r.amt', money(r.taxCost), r.taxCost !== r.cost ? h('div.narr', 'FMV 2018 rule') : null), h('td.r.amt', money(r.proceeds)), h('td.r', amt(r.taxGain, { flow: true })),
          h('td', h('span.pill', (rules[r.cls] || {}).label || r.cls), ' ', h('span.small.muted', r.term === 'flat' ? '' : r.term))))))) : h('div.empty', 'No sales in this tax year.')));
    add(exp, ...exportTable('Capital gains ' + fy + ' ' + e.name, ['Investment', 'ISIN', 'Type', 'Term', 'Bought on', 'Sold on', 'Quantity', 'Cost', 'Cost for tax', 'FMV 31-01-2018', 'Sale value', 'Gain'],
      rows.map(r => [r.asset.name, r.asset.isin || '', (rules[r.cls] || {}).label || r.cls, r.term, r.buyDate, r.sellDate, r.qty, xr(r.cost), xr(r.taxCost), r.fmv2018 ? xr(r.fmv2018) : '', xr(r.proceeds), xr(r.taxGain)])));
  }
  draw();
}

/* ======================= F&O / intraday ======================= */
const SEGMENTS = { futures: 'F&O – futures', options: 'F&O – options', intraday: 'Intraday shares' };
export function renderTrading(root) {
  const e = store.activeEntity();
  const c = store.ctx();
  const out = h('div');
  add(root, h('div.toolbar', periodControl(draw), h('span.spacer'), h('button.btn.primary', { onclick: () => openTrade() }, '+ Add trading result')), out);
  function draw() {
    const fy = currentPeriod().fy || fyOf(currentPeriod().to);
    const s = tradingSummary(c.vouchers, fy);
    clear(out);
    add(out, h('p.muted', { style: { marginTop: 0 } }, 'For occasional trading: enter the result per day or per month from your broker’s P&L. F&O is business income (ITR-3); intraday is speculative business income. Your full trade-book import comes in Phase 4.'),
      h('div.kpis', kpi('Net result · FY ' + fy, amt(s.net, { flow: true }), 'after charges'), kpi('F&O turnover', amt(s.turnover), 'profit + loss, plus option premium received'),
        kpi('Audit needed?', s.turnover > FO_AUDIT_TURNOVER ? h('span.out', 'Likely — turnover above ₹10 crore') : h('span', 'Not on turnover'), 'a loss year under the simple tax option can still need audit — ask your CA'),
        kpi('Entries', String(s.segments.reduce((t2, x) => t2 + x.count, 0)))),
      s.segments.length ? h('div.card', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Segment'), h('th.r', 'Profit days'), h('th.r', 'Loss days'), h('th.r', 'Charges'), h('th.r', 'Net'), h('th.r', 'Turnover'))),
        h('tbody', s.segments.map(x => h('tr', h('td', SEGMENTS[x.segment] || x.segment), h('td.r.amt', money(x.profit)), h('td.r.amt', money(x.loss)), h('td.r.amt', money(x.charges)), h('td.r', amt(x.net, { flow: true })), h('td.r.amt', money(x.turnover)))))))) : null,
      h('div.section-h', h('h2', 'Entries')),
      h('div.card', (() => {
        const { from, to } = fyRange(fy);
        const list = c.vouchers.filter(v => v.meta && v.meta.trade && v.date >= from && v.date <= to).sort((a, b) => b.date.localeCompare(a.date));
        return list.length ? h('table.tbl', h('tbody', list.map(v => h('tr.click', { onclick: () => import('./entry.js').then(m => m.openVoucher(v.id)) }, h('td', fmtDate(v.date)), h('td', SEGMENTS[v.meta.trade.segment], v.narration ? h('div.narr', v.narration) : null), h('td.r', amt(v.meta.trade.pl, { flow: true })), h('td.r.small.muted', 'charges ' + money(v.meta.trade.charges || 0))))))
          : h('div.empty', 'Nothing yet.');
      })()));
  }
  draw();
}
export function openTrade() {
  const e = store.activeEntity(); const c = store.ctxOf(e.id);
  const z = c.ledgers.find(l => /zerodha|kite/i.test(l.name + l.alias));
  const st = { acc: (z || {}).id || defaultPay(c), sign: 1 };
  const seg = select(Object.entries(SEGMENTS).map(([k, v]) => ({ value: k, label: v })), 'options');
  const pl = amountInput(0), charges = amountInput(0), stt = amountInput(0), premium = amountInput(0);
  const date = dateInput(today()), note = h('input.inp', { placeholder: 'optional, e.g. October summary' });
  const signSeg = h('div.seg', [[1, 'Profit'], [-1, 'Loss']].map(([k, l]) => h('button', { class: k === 1 ? 'on' : '', onclick: ev => { st.sign = k; signSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === ev.target)); } }, l)));
  const md = openModal({
    title: 'Trading result', size: 'wide',
    body: h('div.grid', h('div.grid.g3', field('Segment', seg), field('Result', signSeg), field('Amount (before charges)', pl)),
      h('div.grid.g3', field('Charges (brokerage, taxes)', charges), field('Of which STT', stt), field('Option premium received', premium, 'options only — counts in turnover')),
      h('div.grid.g3', field('Date', date), field('Broker account', combo(payItems(c), st.acc, id => { st.acc = id; })), field('Note', note))),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: async () => {
      const amtP = pl.paise() * st.sign, ch = charges.paise();
      if (!amtP && !ch) return toast('Enter the result');
      if (!st.acc) return toast('Choose the broker account');
      const plL = await store.ensureGainLedger(e.id, seg.value === 'intraday' ? 'trade_intraday' : 'trade_fo');
      const chL = ch ? await store.ensureGainLedger(e.id, 'trade_charges') : null;
      const net = amtP - ch;
      const lines = tidyLines([amtP > 0 ? { ledgerId: plL.id, cr: amtP } : amtP < 0 ? { ledgerId: plL.id, dr: -amtP } : null, ch ? { ledgerId: chL.id, dr: ch } : null, net > 0 ? { ledgerId: st.acc, dr: net } : net < 0 ? { ledgerId: st.acc, cr: -net } : null].filter(Boolean));
      try {
        await store.saveVoucher(newVoucher(e.id, { type: inferType(store.ctxOf(e.id), lines), src: 'trading', date: date.value, narration: note.value.trim() || SEGMENTS[seg.value], lines, meta: { trade: { segment: seg.value, pl: amtP, charges: ch, stt: stt.paise(), premium: seg.value === 'options' ? premium.paise() : 0 } } }));
        md.close(); toast('Saved');
      } catch (err) { toast(err.message); }
    } }, 'Save')]
  });
}

/* chooser used by Add entry → Investment */
export function openInvestMenu() {
  const md = openModal({
    title: 'Investment',
    body: h('div.chips', [['Buy / invest', () => openBuy()], ['Sell / redeem', () => openSell()], ['Dividend / interest', () => openIncome()], ['Add money to FD / PPF / NPS', () => pickDeposit()], ['Trading result (F&O / intraday)', () => openTrade()], ['+ New investment', () => openAssetForm()]]
      .map(([l, fn]) => h('button.chip', { onclick: () => { md.close(); fn(); } }, l)))
  });
}
function pickDeposit() {
  const e = store.activeEntity();
  const list = store.assetsOf(e.id).filter(a => !typeOf(a).units && !a.closed);
  if (!list.length) { openAssetForm(null, { type: 'ppf' }); return; }
  const md = openModal({ title: 'Which one?', body: h('div.chips', list.map(a => h('button.chip', { onclick: () => { md.close(); openDeposit(a.id); } }, a.name)), h('button.chip', { onclick: () => { md.close(); openAssetForm(null, { type: 'fd' }); } }, '+ New FD / PPF / NPS')) });
}
