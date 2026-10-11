/* Settings: entities, sites, preferences, year lock, backups; plus Recurring, Health and Audit pages. */
import { h, clear, money, download, add } from '../ui/dom.js';
import { openModal, toast, confirmBox, select, field, amountInput, dateInput, promptBox } from '../ui/widgets.js';
import * as store from '../app/store.js';
import { S } from '../app/store.js';
import { dueDates, FREQS } from '../core/recurring.js';
import { newVoucher, VTYPES } from '../core/vouchers.js';
import { openJournal, openVoucher } from './entry.js';
import { restoreBackup } from './importer.js';
import { fmtDate, today, fyOf, fyRange, fyShift, fyList, addDays } from '../lib/dates.js';
import { uid, nowISO, clone } from '../lib/util.js';
import { shortcutsHelp } from '../app/app.js';

const ACCENTS = ['#d9b35a', '#5aa9e6', '#3fbf8f', '#e9667a', '#b58be0', '#f08c3c', '#7c8db5'];

export function renderSettings(root) {
  const e = store.activeEntity();
  /* entities */
  add(root, h('div.section-h', h('h2', 'Entities'), h('span.muted.small', 'separate books, like Tally companies'), h('span.spacer'), h('button.btn.sm.primary', { onclick: addEntity }, '+ Entity')),
    h('div.card', h('table.tbl', h('tbody', store.sortedEntities().map(x => h('tr',
      h('td', h('span.ent-dot', { style: { background: x.accent, display: 'inline-block', marginRight: '8px' } }), h('b', x.name), x.kind === 'demo' ? h('span.pill.gold', { style: { marginLeft: '6px' } }, 'demo') : null, x.id === e.id ? h('span.pill', { style: { marginLeft: '6px' } }, 'open') : null),
      h('td.small.muted', S.vouchers.filter(v => v.entityId === x.id).length + ' entries' + (x.lockedUpto ? ' · locked to ' + fmtDate(x.lockedUpto) : '')),
      h('td.r', h('button.btn.sm', { onclick: () => editEntity(x) }, 'Edit'))))))),
    store.S.entities.some(x => x.kind === 'demo') ? null : h('p.small', h('a', { href: '#', onclick: async ev => { ev.preventDefault(); const d = await store.recreateDemo(); toast('Demo entity created'); store.setSettings({ activeEntityId: d.id }); } }, 'Recreate the demo entity')));

  /* year lock */
  const cur = fyOf(today());
  add(root, h('div.section-h', h('h2', 'Close & lock a year — ' + e.name)),
    h('div.card', h('div.card-b', { style: { paddingTop: '12px' } },
      h('p', { style: { marginTop: 0 } }, e.lockedUpto ? 'Books are locked up to ' + fmtDate(e.lockedUpto) + '. Entries on or before that date cannot be added, edited or deleted.' : 'No period is locked. Balances always carry forward automatically — locking just protects a finished year.'),
      h('div.btnrow', ...fyList(4, 0).filter(f => f !== cur).slice(0, 3).map(f => h('button.btn.sm', { onclick: () => lockTo(e, fyRange(f).to) }, 'Lock up to FY ' + f)),
        e.lockedUpto ? h('button.btn.sm.danger', { onclick: () => lockTo(e, '') }, 'Unlock') : null))));

  /* preferences */
  const theme = select([{ value: 'auto', label: 'Follow device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], S.settings.theme, { onchange: ev => store.setSettings({ theme: ev.target.value }).then(() => location.reload()) });
  const c = store.ctx();
  const moneyOpts = c.ledgers.filter(l => !l.archived && ['cash', 'bank', 'card'].includes(c.natureOf(l))).map(l => ({ value: l.id, label: l.name }));
  const defMoney = select([{ value: '', label: 'Cash in Hand' }, ...moneyOpts], S.settings.defaultMoney[e.id] || '', { onchange: ev => store.setSettings({ defaultMoney: { ...S.settings.defaultMoney, [e.id]: ev.target.value } }) });
  add(root, h('div.section-h', h('h2', 'Preferences')),
    h('div.card', h('div.card-b', { style: { paddingTop: '12px' } }, h('div.grid.g3',
      field('Theme', theme),
      field('Default account for quick entry (' + e.name + ')', defMoney),
      field('Owner tags', h('input.inp', { value: S.settings.owners.join(', '), onchange: ev => store.setSettings({ owners: ev.target.value.split(',').map(s => s.trim()).filter(Boolean) }) }), 'comma separated')),
      h('div.btnrow', { style: { marginTop: '12px' } },
        h('label.check', h('input', { type: 'checkbox', checked: S.settings.proMode, onchange: ev => store.setSettings({ proMode: ev.target.checked }) }), 'Pro mode (journal vouchers with raw debit/credit in Add entry)'),
        h('label.check', h('input', { type: 'checkbox', checked: S.settings.hideAmounts, onchange: ev => store.setSettings({ hideAmounts: ev.target.checked }) }), 'Hide amounts'),
        h('span.spacer'), h('button.btn.sm', { onclick: shortcutsHelp }, 'Keyboard shortcuts')))));

  /* backup */
  const p = S.persistence || {};
  add(root, h('div.section-h', h('h2', 'Backup')),
    h('div.card', h('div.card-b', { style: { paddingTop: '12px' } },
      h('p', { style: { marginTop: 0 } }, 'Last downloaded backup: ', h('b', S.settings.lastBackupAt ? fmtDate(S.settings.lastBackupAt.slice(0, 10)) : 'never'), '. ',
        p.supported ? (p.granted ? h('span.in', '✓ Browser storage is persistent (won’t be cleared automatically).') : h('span.warn-t', 'Browser may clear storage under pressure — keep downloading backups.')) : ''),
      h('div.btnrow',
        h('button.btn.primary', { onclick: downloadBackup }, '⇩ Download backup'),
        h('button.btn', { onclick: restoreBackup }, 'Restore from file…'),
        h('button.btn', { onclick: showSnapshots }, 'Automatic snapshots on this device'),
        h('a.btn', { href: '#/audit' }, 'Audit trail')),
      h('p.small.muted', 'The app also snapshots your data automatically before upgrades, restores and entity deletions (last 5 kept on this device). Laptop ↔ phone sync and encrypted storage with PIN come with Phase 4.'))));
}

async function lockTo(e, date) {
  if (date && !(await confirmBox('Lock books?', 'Entries on or before ' + fmtDate(date) + ' will be read-only for ' + e.name + '. You can unlock later.', 'Lock'))) return;
  await store.saveEntity({ ...e, lockedUpto: date });
  toast(date ? 'Locked up to ' + fmtDate(date) : 'Unlocked');
}
async function downloadBackup() {
  const data = await store.exportAll();
  download('DoctorWealth-Books-backup-' + today() + '.json', JSON.stringify(data), 'application/json');
  await store.setSettings({ lastBackupAt: nowISO() });
  toast('Backup downloaded — keep it somewhere safe');
}
async function showSnapshots() {
  const list = await store.listSnapshots();
  const md = openModal({
    title: 'Automatic snapshots', sub: 'Taken before upgrades, restores and deletions. Kept on this device only.',
    body: list.length ? h('table.tbl', h('tbody', list.map(b => h('tr', h('td', fmtDate(b.at.slice(0, 10)) + ' ' + b.at.slice(11, 16)), h('td', b.reason), h('td.small.muted', Math.round(b.size / 1024) + ' KB'),
      h('td.r', h('button.btn.sm', { onclick: () => download('snapshot-' + b.at.slice(0, 10) + '.json', JSON.stringify(b.data), 'application/json') }, 'Download'), ' ',
        h('button.btn.sm.danger', { onclick: async () => { if (await confirmBox('Restore this snapshot?', 'Replaces all current data (which is snapshotted first).', 'Restore', true)) { md.close(); await store.restoreAll(b.data); toast('Snapshot restored'); } } }, 'Restore'))))))
      : h('div.empty', 'No snapshots yet.')
  });
}

function addEntity() {
  const name = h('input.inp', { placeholder: 'e.g. HUF, Parent, Joint', autofocus: true });
  const tpl = select([{ value: 'spouse', label: 'Standard personal ledgers' }, { value: 'self', label: 'Doctor (full practice ledgers)' }, { value: 'blank', label: 'Blank (groups only)' }], 'spouse');
  const copy = select([{ value: '', label: '— don’t copy —' }, ...store.sortedEntities().map(e => ({ value: e.id, label: e.name }))], '');
  let accent = ACCENTS[S.entities.length % ACCENTS.length];
  const sw = h('div.btnrow', ACCENTS.map(a => h('button.btn.icon.sm', { style: { background: a, borderColor: a }, 'aria-label': 'Accent ' + a, onclick: ev => { accent = a; sw.querySelectorAll('button').forEach(b => b.style.outline = ''); ev.target.style.outline = '2px solid var(--ink)'; } })));
  const md = openModal({
    title: 'New entity', body: h('div.grid', field('Name', name), field('Starter ledgers', tpl), field('Also copy masters from', copy, 'Copies groups and ledgers (no balances)'), field('Accent colour', sw)),
    foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: async () => {
      if (!name.value.trim()) return toast('Enter a name');
      const e = await store.addEntity({ name: name.value.trim(), accent, template: tpl.value, copyFrom: copy.value });
      md.close(); await store.setSettings({ activeEntityId: e.id }); toast('Entity created');
    } }, 'Create')]
  });
}
function editEntity(e) {
  const name = h('input.inp', { value: e.name });
  let accent = e.accent;
  const sw = h('div.btnrow', ACCENTS.map(a => h('button.btn.icon.sm', { style: { background: a, borderColor: a, outline: a === accent ? '2px solid var(--ink)' : '' }, 'aria-label': 'Accent ' + a, onclick: ev => { accent = a; sw.querySelectorAll('button').forEach(b => b.style.outline = ''); ev.target.style.outline = '2px solid var(--ink)'; } })));
  const sites = h('input.inp', { value: (e.sites || []).map(s => s.name).join(', ') });
  const others = store.sortedEntities().filter(x => x.id !== e.id);
  const md = openModal({
    title: 'Edit entity', size: 'wide',
    body: h('div.grid', field('Name', name, 'Renaming never breaks history — entries point to permanent ids.'), field('Accent colour', sw), field('Sites', sites, 'Comma separated, e.g. PNH, DKM, Clinic. Removing a site keeps entries; they just lose the tag.'),
      others.length ? field('Inter-entity current account', h('div.btnrow', others.map(o => h('button.btn.sm', { onclick: async () => { const l = await store.addInterEntityLedger(e.id, o.id); await store.addInterEntityLedger(o.id, e.id); toast('“' + l.name + '” ready in both entities'); } }, 'With ' + o.name))), 'For money one person holds or pays for the other. Both sides cancel in the family view.') : null),
    foot: [h('button.btn.danger.left', { onclick: async () => {
      if (!(await confirmBox('Delete “' + e.name + '”?', 'All its ledgers and ' + S.vouchers.filter(v => v.entityId === e.id).length + ' entries are deleted. A snapshot is kept on this device first.', 'Delete entity', true))) return;
      if (e.kind !== 'demo') { const typed = await promptBox('Confirm', 'Type the entity name to delete it'); if (typed !== e.name) return toast('Name did not match — nothing deleted'); }
      try { await store.deleteEntity(e.id); md.close(); toast('Entity deleted'); } catch (err) { toast(err.message); }
    } }, 'Delete'),
    h('button.btn', { onclick: () => md.close() }, 'Cancel'),
    h('button.btn.primary', { onclick: async () => {
      if (!name.value.trim()) return toast('Enter a name');
      const names = sites.value.split(',').map(s => s.trim()).filter(Boolean);
      const keep = (e.sites || []).filter(s => names.includes(s.name));
      const add = names.filter(n => !keep.some(s => s.name === n)).map(n => ({ id: uid('site'), name: n }));
      await store.saveEntity({ ...e, name: name.value.trim(), accent, sites: [...keep, ...add].sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name)) });
      md.close(); toast('Saved');
    } }, 'Save')]
  });
}

/* ---------- recurring ---------- */
export function renderRecurring(root) {
  const e = store.activeEntity();
  const c = store.ctx();
  const list = S.recurring.filter(r => r.entityId === e.id);
  add(root, h('p.muted', { style: { marginTop: 0 } }, 'EMIs, SIPs, rent, salaries. Due instances are offered here and on the dashboard — never posted without you.'),
    h('div.toolbar', h('span.spacer'), h('button.btn.sm.primary', { onclick: () => editRecurring(null) }, '+ Recurring entry')));
  if (!list.length) { add(root, h('div.card', h('div.empty', 'None yet. Create one here, or open any voucher and duplicate it as a template.'))); return; }
  add(root, h('div.card', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Name'), h('th', 'Schedule'), h('th.r', 'Amount'), h('th', 'Last posted'), h('th', 'Due'), h('th'))),
    h('tbody', list.map(r => {
      const due = dueDates(r, today());
      const tot = r.template.lines.reduce((t, l) => t + l.dr, 0);
      return h('tr', h('td', h('b', r.name), r.paused ? h('span.pill', { style: { marginLeft: '6px' } }, 'paused') : null, h('div.narr', r.template.lines.map(l => (l.dr ? 'Dr ' : 'Cr ') + ((c.lById.get(l.ledgerId) || {}).name || '?')).join(', '))),
        h('td', FREQS[r.freq].name + ' from ' + fmtDate(r.startDate) + (r.endDate ? ' to ' + fmtDate(r.endDate) : '')),
        h('td.r.amt', money(tot)), h('td', r.lastPosted ? fmtDate(r.lastPosted) : '—'),
        h('td', due.length ? h('span.pill.warn', due.length + ' due') : h('span.muted.small', 'next ' + fmtDate(nextAfter(r)))),
        h('td.r.nowrap', due.length ? h('button.btn.sm.primary', { onclick: () => postDue(r, due) }, 'Post ' + due.length) : null, ' ', h('button.btn.sm', { onclick: () => editRecurring(r) }, 'Edit')));
    }))))));
}
function nextAfter(r) { const d = dueDates({ ...r, lastPosted: r.lastPosted && r.lastPosted > today() ? r.lastPosted : today() }, addDays(today(), 800), 1); return d[0] || ''; }
async function postDue(r, due) {
  if (!(await confirmBox('Post ' + due.length + ' entr' + (due.length === 1 ? 'y' : 'ies') + '?', r.name + ': ' + due.map(fmtDate).join(', '), 'Post'))) return;
  const vs = due.map(d => { const v = newVoucher(r.entityId, { ...clone(r.template), date: d, recurringId: r.id }); return v; });
  try { await store.saveVouchers(vs, [{ store: 'recurring', put: { ...r, lastPosted: due[due.length - 1] } }]); toast(due.length + ' posted'); } catch (e) { toast(e.message); }
}
function editRecurring(r) {
  const e = store.activeEntity();
  const st = r ? clone(r) : { id: uid('rec'), entityId: e.id, name: '', freq: 'monthly', startDate: today(), endDate: '', lastPosted: '', paused: false, template: null, createdAt: nowISO() };
  const name = h('input.inp', { value: st.name, placeholder: 'e.g. Home loan EMI', autofocus: true });
  const freq = select(Object.entries(FREQS).map(([k, f]) => ({ value: k, label: f.name })), st.freq);
  const start = dateInput(st.startDate), end = dateInput(st.endDate);
  const paused = h('input', { type: 'checkbox', checked: st.paused });
  const lines = h('div.vpreview');
  const drawLines = () => { clear(lines); if (!st.template) { add(lines, h('span.muted', 'No entry yet — set it with “Set the entry”.')); return; } const c = store.ctx(); add(lines, ...st.template.lines.map(l => h('div.ln', h('span', (l.dr ? 'Dr ' : 'Cr ') + ((c.lById.get(l.ledgerId) || {}).name || '?')), h('span.amt', money(l.dr || l.cr))))); };
  drawLines();
  const md = openModal({
    title: r ? 'Edit recurring entry' : 'New recurring entry', size: 'wide',
    body: h('div.grid', h('div.grid.g4', h('div.span2', field('Name', name)), field('Frequency', freq), field('First date', start)), h('div.grid.g4', field('End date (optional)', end), h('label.check', { style: { alignSelf: 'end' } }, paused, 'Paused')),
      lines, h('div', h('button.btn.sm', { onclick: setEntry }, 'Set the entry…'))),
    foot: [r ? h('button.btn.danger.left', { onclick: async () => { await store.commit([{ store: 'recurring', del: r.id }]); md.close(); toast('Deleted'); } }, 'Delete') : null,
      h('button.btn', { onclick: () => md.close() }, 'Cancel'),
      h('button.btn.primary', { onclick: async () => {
        if (!name.value.trim() || !st.template) return toast('Name and entry are required');
        if (!start.value) return toast('Choose the first date');
        await store.commit([{ store: 'recurring', put: { ...st, name: name.value.trim(), freq: freq.value, startDate: start.value, endDate: end.value, paused: paused.checked } }]);
        md.close(); toast('Saved');
      } }, 'Save')]
  });
  function setEntry() {
    const t = st.template || {};
    openJournal(e.id, { type: t.type || 'payment', date: start.value || today(), narration: t.narration || name.value, lines: t.lines && t.lines.length ? t.lines : undefined, tags: t.tags || {} },
      { title: 'Recurring entry', onCapture: d => { st.template = { type: d.type, src: 'recurring', narration: d.narration, lines: d.lines, tags: d.tags }; drawLines(); } });
  }
}

/* ---------- health ---------- */
export function renderHealth(root, health) {
  const p = health.persistence || {};
  add(root, h('div', { class: 'note ' + (health.ok ? 'ok' : 'bad'), style: { marginBottom: '12px' } }, health.ok ? '✓ All books pass the integrity checks: every voucher balances, no entry points to a missing ledger, trial balance and balance sheet tally.' : '⚠ Problems found — details below.'),
    h('div.card', h('table.tbl', h('tbody',
      store.sortedEntities().map(e => { const errs = health.issues.filter(i => i.text.startsWith(e.name + ':')); return h('tr', h('td', h('b', e.name)), h('td', errs.length ? errs.map(i => h('div.out', i.text.slice(e.name.length + 2))) : h('span.in', '✓ ' + S.vouchers.filter(v => v.entityId === e.id).length + ' entries, all checks pass'))); }),
      h('tr', h('td', h('b', 'Backups')), h('td', { class: health.backup.level === 'ok' ? 'in' : 'warn-t' }, health.backup.text)),
      h('tr', h('td', h('b', 'Storage')), h('td', p.supported ? (p.granted ? h('span.in', '✓ Persistent storage granted') : h('span.warn-t', 'Not persistent — the browser could clear data under storage pressure. Install the app and download backups.')) : 'Unknown in this browser', p.usage ? h('span.muted.small', ' · ' + Math.round(p.usage / 1024) + ' KB used') : null)),
      h('tr', h('td', h('b', 'App')), h('td', 'Version ' + store.APP_VERSION + ' · data schema ' + store.SCHEMA_VERSION + ' · ' + (navigator.onLine ? 'online' : 'offline')))))));
}

/* ---------- audit ---------- */
export async function renderAudit(root) {
  const e = store.activeEntity();
  const list = (await store.listAudit()).filter(a => a.entityId === e.id).slice(0, 500);
  add(root, h('p.muted', { style: { marginTop: 0 } }, 'Every create, edit and delete is recorded with a before/after copy. Latest 500 for ' + e.name + '.'),
    h('div.card', list.length ? h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'When'), h('th', 'Action'), h('th', 'What'), h('th'))),
      h('tbody', list.map(a => h('tr', h('td.nowrap', fmtDate(a.at.slice(0, 10)) + ' ' + a.at.slice(11, 16)), h('td', h('span.pill' + (a.action === 'delete' ? '.bad' : a.action === 'create' ? '.ok' : ''), a.action), ' ', a.kind), h('td', a.summary),
        h('td.r', a.kind === 'voucher' && a.action === 'delete' && a.before ? h('button.btn.sm', { onclick: async () => { try { const v = { ...a.before }; await store.saveVoucher(v); toast('Restored ' + v.no); } catch (err) { toast(err.message); } } }, 'Restore')
          : a.kind === 'voucher' && store.voucher(a.refId) ? h('button.btn.sm', { onclick: () => openVoucher(a.refId) }, 'Open') : null))))))
      : h('div.empty', 'Nothing recorded yet.')));
}
