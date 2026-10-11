/* App shell: sidebar / bottom bar, router, entity switcher, theme, global search and Tally-style shortcuts. */
import { h, clear, $, money, add } from '../ui/dom.js';
import { openModal, toast, modalOpen } from '../ui/widgets.js';
import * as store from './store.js';
import { S } from './store.js';
import { checkEntity, checkBackups } from '../core/integrity.js';
import { fmtDate } from '../lib/dates.js';
import { toPaise } from '../lib/money.js';

import { renderDashboard } from '../views/dashboard.js';
import { renderDaybook } from '../views/daybook.js';
import { openEntry, openVoucher, openQuickAdd, renderDaily } from '../views/entry.js';
import { renderLedgers, renderLedger } from '../views/masters.js';
import { renderReport } from '../views/reports.js';
import { renderImport } from '../views/importer.js';
import { renderSettings, renderRecurring, renderHealth, renderAudit } from '../views/settings.js';

const NAV = [
  ['Overview', [['dashboard', '◧', 'Dashboard', 'G D'], ['family', '⌂', 'Family view', '']]],
  ['Entry', [['quick', '+', 'Quick add', 'N'], ['daybook', '☰', 'Day book', 'G B'], ['daily', '✚', 'Clinic & hospital daily', ''], ['recurring', '↻', 'Recurring', '']]],
  ['Books', [['ledgers', '▤', 'Ledgers & groups', 'G L']]],
  ['Reports', [['tb', '⚖', 'Trial balance', 'G T'], ['pl', '↕', 'Profit & loss', 'G P'], ['bs', '▦', 'Balance sheet', 'G S'], ['cf', '⇄', 'Cash flow', 'G C'], ['networth', '↗', 'Net worth', ''], ['analysis', '◔', 'Analysis', 'G A'], ['cash', '₹', 'Cash vs digital', '']]],
  ['Data', [['import', '⇩', 'Import', 'G I'], ['settings', '⚙', 'Settings & backup', ''], ['health', '✓', 'Health', '']]]
];
const TITLES = Object.fromEntries(NAV.flatMap(([, items]) => items.map(i => [i[0], i[2]])));
const REPORTS = new Set(['tb', 'pl', 'bs', 'cf', 'networth', 'analysis', 'cash', 'family']);

let route = { name: 'dashboard', args: [] };
let root, side, content, titleEl, health = { ok: true, issues: [] };

export function start() {
  applyTheme();
  root = $('#app');
  clear(root);
  side = h('aside.side', { 'aria-label': 'Main navigation' });
  titleEl = h('div.title');
  content = h('main.content', { id: 'content', tabindex: '-1' });
  const topbar = h('header.topbar',
    h('button.btn.ghost.icon.menu-btn', { 'aria-label': 'Menu', onclick: () => side.classList.toggle('open') }, '☰'),
    titleEl,
    h('button.btn.ghost.icon', { title: 'Search (Ctrl+K)', 'aria-label': 'Search', onclick: openSearch }, '⌕'),
    h('button.btn.ghost.icon', { id: 'hideBtn', title: 'Hide amounts (Alt+H)', 'aria-label': 'Hide amounts', onclick: toggleHide }, '◉'),
    h('button.btn.ghost.icon', { title: 'Theme', 'aria-label': 'Change theme', onclick: cycleTheme }, '◐'),
    h('button.btn.primary.hide-phone', { onclick: () => openQuickAdd(), title: 'Quick add (N)' }, '+ Add'));
  const bottom = h('nav.bottombar', { 'aria-label': 'Quick navigation' },
    navBtn('dashboard', '◧', 'Home'), navBtn('daybook', '☰', 'Day book'),
    h('button.fab', { 'aria-label': 'Quick add', onclick: () => openQuickAdd() }, '+'),
    navBtn('pl', '↕', 'Reports'), h('button', { onclick: () => side.classList.add('open') }, h('span.ic', '≡'), 'More'));
  add(root, h('div.shell', side, h('div.main', h('div.accent-bar'), topbar, content)), bottom);
  side.addEventListener('click', e => { if (e.target === side) side.classList.remove('open'); });
  window.addEventListener('hashchange', () => { parseRoute(); render(); });
  document.addEventListener('keydown', onKey);
  store.subscribe(() => { applyAccent(); runHealth(); render(); });
  parseRoute(); runHealth(); applyAccent(); render();
  if (S.settings.firstRun) { store.setSettings({ firstRun: false }); welcome(); }
}
function navBtn(name, ic, label) { return h('button', { 'data-r': name, onclick: () => go(name) }, h('span.ic', ic), label); }

export function go(name, ...args) {
  if (name === 'quick') { openQuickAdd(); return; }
  location.hash = '#/' + [name, ...args.map(encodeURIComponent)].join('/');
  side.classList.remove('open');
}
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  route = { name: parts[0] || 'dashboard', args: parts.slice(1) };
}

function renderSide() {
  const e = store.activeEntity();
  add(clear(side), 
    h('div.brand', h('div.brand-mark', '₹'), h('div', h('b', 'DoctorWealth'), h('small', 'Books · v' + store.APP_VERSION))),
    h('button.ent-switch', { onclick: switchEntity, title: 'Switch entity (F3)' }, h('span.ent-dot', { style: { background: e.accent } }), h('span', e.name), h('span.k', 'F3')),
    NAV.map(([grp, items]) => h('div.nav-group', h('h6', grp), items.map(([name, ic, label, kbd]) =>
      h('button.nav-item' + (route.name === name ? '.on' : ''), { onclick: () => go(name), 'aria-current': route.name === name ? 'page' : null }, h('span.ic', ic), label, kbd ? h('span.kbd', kbd) : null)))),
    h('div.side-foot',
      h('div', { class: health.ok ? 'health-ok' : 'health-bad', style: { cursor: 'pointer' }, onclick: () => go('health') }, health.ok ? '✓ Books tally' : '⚠ ' + health.issues.length + ' issue(s) — see Health'),
      h('div', 'Works offline · data stays on this device')));
  document.querySelectorAll('.bottombar [data-r]').forEach(b => b.classList.toggle('on', b.dataset.r === route.name));
}

function render() {
  renderSide();
  const e = store.activeEntity();
  const name = route.name;
  clear(content);
  if (e.kind === 'demo') add(content, h('div.demo-banner', h('span', h('b', 'Demo entity'), ' — practice data. Try anything here; your real books are untouched.'), h('span.spacer'), h('button.btn.sm', { onclick: () => switchTo(store.sortedEntities().find(x => x.kind !== 'demo').id) }, 'Switch to my books')));
  let title = TITLES[name] || '';
  try {
    if (name === 'dashboard') renderDashboard(content);
    else if (name === 'daybook') renderDaybook(content, route.args);
    else if (name === 'daily') renderDaily(content);
    else if (name === 'ledgers') renderLedgers(content);
    else if (name === 'ledger') { const l = store.ledger(route.args[0]); title = l ? l.name : 'Ledger'; renderLedger(content, route.args[0]); }
    else if (REPORTS.has(name)) renderReport(content, name, route.args);
    else if (name === 'import') renderImport(content);
    else if (name === 'settings') renderSettings(content);
    else if (name === 'recurring') renderRecurring(content);
    else if (name === 'health') renderHealth(content, health);
    else if (name === 'audit') { title = 'Audit trail'; renderAudit(content); }
    else { title = 'Not found'; add(content, h('div.empty', 'Page not found. ', h('a', { href: '#/dashboard' }, 'Go to dashboard'))); }
  } catch (err) {
    console.error(err);
    add(content, h('div.note.bad', 'Something went wrong showing this page: ' + err.message));
  }
  add(clear(titleEl), h('span.ent-dot', { style: { background: e.accent } }), h('span.crumb.hide-phone', e.name + ' ·'), h('span', title));
  document.title = title + ' · ' + e.name + ' · DoctorWealth';
}

/* ---------- integrity on open & after every change ---------- */
function runHealth() {
  const issues = [];
  for (const e of store.S.entities) {
    const r = checkEntity(store.dataOf(e.id));
    for (const i of r.issues) issues.push({ ...i, text: e.name + ': ' + i.text });
  }
  const b = checkBackups(S.settings.lastBackupAt);
  health = { ok: !issues.some(i => i.level === 'error'), issues, backup: b, persistence: S.persistence };
}

/* ---------- entity ---------- */
export async function switchTo(id) { await store.setSettings({ activeEntityId: id }); toast('Switched to ' + store.activeEntity().name); }
function switchEntity() {
  const ents = store.sortedEntities();
  const md = openModal({
    title: 'Switch entity', sub: 'Each entity is a separate set of books (like Tally companies).',
    body: h('div.cards', ents.map((e, i) => h('button.btn', { style: { justifyContent: 'flex-start', height: '44px' }, autofocus: e.id === S.settings.activeEntityId, onclick: () => { md.close(); switchTo(e.id); } },
      h('span.ent-dot', { style: { background: e.accent } }), e.name, e.kind === 'demo' ? h('span.pill.gold', 'demo') : null, h('span.spacer'), h('span.muted.small', String(i + 1))))),
    foot: [h('button.btn', { onclick: () => { md.close(); go('family'); } }, 'Family view'), h('button.btn', { onclick: () => { md.close(); go('settings'); } }, 'Manage entities')]
  });
  md.el.addEventListener('keydown', e => { const n = Number(e.key); if (n >= 1 && n <= ents.length) { md.close(); switchTo(ents[n - 1].id); } });
}

/* ---------- theme & privacy ---------- */
function applyTheme() {
  const t = S.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('dwb_theme', JSON.stringify(t)); } catch { /* storage blocked: theme still applies this session */ }
}
function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(S.settings.theme) + 1) % 3];
  store.setSettings({ theme: next }).then(() => { applyTheme(); toast('Theme: ' + next); });
}
function applyAccent() {
  const e = store.activeEntity();
  document.documentElement.style.setProperty('--accent', e.accent || '#d9b35a');
  const hb = $('#hideBtn'); if (hb) hb.textContent = S.settings.hideAmounts ? '◌' : '◉';
}
function toggleHide() { store.setSettings({ hideAmounts: !S.settings.hideAmounts }).then(() => toast(S.settings.hideAmounts ? 'Amounts hidden' : 'Amounts shown')); }

/* ---------- search ---------- */
function openSearch() {
  const inp = h('input.inp', { placeholder: 'Ledger, narration, voucher no. or amount…', autofocus: true });
  const out = h('div', { style: { marginTop: '10px', maxHeight: '60vh', overflowY: 'auto' } });
  const md = openModal({ title: 'Search', body: [inp, out], size: 'wide' });
  let results = [], idx = 0;
  const run = () => {
    const q = inp.value.trim().toLowerCase();
    results = [];
    if (q.length >= 2) {
      const c = store.ctx();
      for (const l of c.ledgers) if ((l.name + ' ' + l.alias).toLowerCase().includes(q)) results.push({ label: l.name, sub: (c.groupOf(l) || {}).name + ' · ledger', fn: () => go('ledger', l.id) });
      for (const k of Object.keys(TITLES)) if (TITLES[k].toLowerCase().includes(q)) results.push({ label: TITLES[k], sub: 'page', fn: () => go(k) });
      const p = toPaise(q);
      const vs = c.vouchers.filter(v => (v.narration || '').toLowerCase().includes(q) || (v.no || '').toLowerCase().includes(q) || (p && v.lines.some(x => x.dr === p || x.cr === p)))
        .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
      for (const v of vs) results.push({ label: (v.narration || '(no narration)'), sub: fmtDate(v.date) + ' · ' + v.no + ' · ' + money(v.lines.reduce((t, x) => t + x.dr, 0)), fn: () => openVoucher(v.id) });
    }
    idx = 0; draw();
  };
  const draw = () => {
    clear(out);
    if (!results.length) { add(out, h('div.muted.small', inp.value.trim().length < 2 ? 'Type at least 2 characters.' : 'No results.')); return; }
    results.slice(0, 60).forEach((r, i) => add(out, h('div.combo-opt' + (i === idx ? '.on' : ''), { onclick: () => { md.close(); r.fn(); } }, h('span', r.label), h('span.g', r.sub))));
  };
  inp.addEventListener('input', run);
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, results.length - 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && results[idx]) { md.close(); results[idx].fn(); }
  });
  run();
}

/* ---------- keyboard ---------- */
let gPending = 0;
function onKey(e) {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!modalOpen()) openSearch(); return; }
  if (e.altKey && e.key.toLowerCase() === 'h') { e.preventDefault(); toggleHide(); return; }
  const fkeys = { F3: () => switchEntity(), F4: () => openEntry('transfer'), F5: () => openEntry('expense'), F6: () => openEntry('income'), F7: () => openEntry('journal') };
  if (fkeys[e.key]) { e.preventDefault(); if (!modalOpen()) fkeys[e.key](); return; }
  if (typing || modalOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (gPending && Date.now() - gPending < 1200) {
    gPending = 0;
    const map = { d: 'dashboard', b: 'daybook', l: 'ledgers', t: 'tb', p: 'pl', s: 'bs', c: 'cf', a: 'analysis', i: 'import', f: 'family', h: 'health' };
    if (map[k]) { e.preventDefault(); go(map[k]); }
    return;
  }
  if (k === 'g') { gPending = Date.now(); return; }
  if (k === 'n' || k === 'q') { e.preventDefault(); openQuickAdd(); return; }
  if (k === '/') { e.preventDefault(); openSearch(); return; }
  if (k === '?') { e.preventDefault(); shortcutsHelp(); }
}
export function shortcutsHelp() {
  const rows = [['N / Q', 'Quick add'], ['F6', 'Income (receipt)'], ['F5', 'Expense (payment)'], ['F4', 'Transfer (contra)'], ['F7', 'Journal (pro)'], ['F3', 'Switch entity'],
    ['Ctrl+K or /', 'Search'], ['Alt+H', 'Hide / show amounts'], ['Ctrl+Enter', 'Save the open form'], ['Esc', 'Close'],
    ['G then D/B/L', 'Dashboard / Day book / Ledgers'], ['G then T/P/S/C', 'Trial balance / P&L / Balance sheet / Cash flow'], ['G then A/I/F/H', 'Analysis / Import / Family / Health'], ['?', 'This help']];
  openModal({ title: 'Keyboard shortcuts', body: h('table.tbl', h('tbody', rows.map(r => h('tr', h('td', h('b', r[0])), h('td', r[1]))))) });
}
function welcome() {
  const md = openModal({
    title: 'Welcome to DoctorWealth Books',
    body: h('div', h('p', 'Double-entry books for You, Spouse and the family — offline, on this device.'),
      h('ul', h('li', 'You are in the ', h('b', 'Demo'), ' entity with a sample year: try entries, reports and imports freely.'),
        h('li', 'Your real books are ', h('b', 'You'), ' and ', h('b', 'Spouse'), ', with editable starter ledgers.'),
        h('li', 'Coming from the old DoctorWealth? ', h('b', 'Import → Old DoctorWealth data'), ' brings everything across and checks every balance.'),
        h('li', 'Press ', h('b', '?'), ' any time for keyboard shortcuts.'))),
    foot: [h('button.btn', { onclick: () => { md.close(); go('import'); } }, 'Import old data'), h('button.btn.primary', { onclick: () => md.close() }, 'Explore the demo')]
  });
}
