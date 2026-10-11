/* Modal, toast, confirm, ledger combobox, amount/date inputs, table + CSV/Excel export helpers. */
import { h, clear, download, add } from './dom.js';
import { toPaise, toRupeeString } from '../lib/money.js';
import { toCSV } from '../lib/util.js';

/* ---------- toast ---------- */
let toastEl, toastT;
export function toast(msg, action) {
  if (!toastEl) { toastEl = h('div.toast', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastEl); }
  add(clear(toastEl), h('span', msg));
  if (action) add(toastEl, h('button', { onclick: () => { toastEl.classList.remove('on'); action.fn(); } }, action.label));
  toastEl.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), action ? 6000 : 2800);
}

/* ---------- modal ---------- */
const stack = [];
export function openModal({ title, sub, body, foot, size = '', sticky = false, onClose }) {
  const close = () => {
    const i = stack.indexOf(m); if (i >= 0) stack.splice(i, 1);
    back.remove(); document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  const prevFocus = document.activeElement;
  const m = h('div.modal' + (size ? '.' + size : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-h', h('h3', title), h('button.btn.ghost.icon.x', { onclick: () => tryClose(), 'aria-label': 'Close', title: 'Close (Esc)' }, '✕')),
    sub ? h('div.modal-sub', sub) : null,
    h('div.modal-b', body),
    foot ? h('div.modal-f', foot) : null);
  const back = h('div.modal-back', { onmousedown: e => { if (e.target === back && !sticky) tryClose(); } }, m);
  function tryClose() { if (sticky && typeof sticky === 'function') { sticky(close); return; } if (sticky === true) { confirmBox('Discard changes?', 'Nothing has been saved.', 'Discard').then(ok => ok && close()); return; } close(); }
  function onKey(e) { if (e.key === 'Escape' && stack[stack.length - 1] === m) { e.stopPropagation(); e.preventDefault(); tryClose(); } }
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
  stack.push(m);
  setTimeout(() => { const f = m.querySelector('[autofocus]') || m.querySelector('.modal-b input:not([type=checkbox]), .modal-b select, .modal-b textarea'); if (f) f.focus(); }, 30);
  return { close, el: m };
}
export const modalOpen = () => stack.length > 0;

export function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    let done = false;
    const md = openModal({
      title, body: h('p', { style: { margin: 0 } }, text),
      foot: [h('button.btn', { onclick: () => { done = true; md.close(); resolve(false); } }, 'Cancel'),
        h('button.btn.' + (danger ? 'danger' : 'primary'), { autofocus: true, onclick: () => { done = true; md.close(); resolve(true); } }, okLabel)],
      onClose: () => { if (!done) resolve(false); }
    });
  });
}
export function promptBox(title, label, value = '') {
  return new Promise(resolve => {
    let done = false;
    const inp = h('input.inp', { value, autofocus: true });
    const ok = () => { done = true; md.close(); resolve(inp.value.trim()); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    const md = openModal({ title, body: h('label.fld', label, inp), foot: [h('button.btn', { onclick: () => md.close() }, 'Cancel'), h('button.btn.primary', { onclick: ok }, 'OK')], onClose: () => { if (!done) resolve(null); } });
  });
}

/* ---------- inputs ---------- */
export function amountInput(paise, attrs = {}) {
  const el = h('input.inp.amount', { inputMode: 'decimal', autocomplete: 'off', placeholder: '0.00', ...attrs });
  if (paise) el.value = toRupeeString(paise).replace(/\.00$/, '');
  el.paise = () => { const p = toPaise(el.value); return p === null ? 0 : p; };
  el.addEventListener('blur', () => { const p = toPaise(el.value); if (p !== null && el.value.trim()) el.value = toRupeeString(p).replace(/\.00$/, ''); });
  return el;
}
export function dateInput(value, attrs = {}) { return h('input.inp', { type: 'date', value, ...attrs }); }
export function select(options, value, attrs = {}) {
  const s = h('select.inp', attrs, options.map(o => h('option', { value: o.value }, o.label)));
  s.value = value ?? '';
  return s;
}
export function field(label, input, hint) { return h('label.fld', h('span', label), input, hint ? h('span.hint', hint) : null); }

/* ---------- ledger combobox (keyboard first) ----------
   items: [{ id, label, group }] ; onPick(id) ; opts.onCreate(text) offers "+ Create “text”" */
export function combo(items, value, onPick, opts = {}) {
  const wrap = h('div.combo');
  const inp = h('input.inp' + (opts.sm ? '.sm' : ''), { placeholder: opts.placeholder || 'Type to search…', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false' });
  let list = null, idx = 0, current = value || '', shown = [];
  const labelOf = id => (items.find(i => i.id === id) || {}).label || '';
  inp.value = labelOf(current);
  const close = () => { if (list) { list.remove(); list = null; inp.setAttribute('aria-expanded', 'false'); } };
  const pick = id => { current = id; inp.value = labelOf(id); close(); onPick(id); };
  function render() {
    const q = inp.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    shown = items.filter(i => !words.length || words.every(w => (i.label + ' ' + (i.group || '') + ' ' + (i.alias || '')).toLowerCase().includes(w)));
    if (q === labelOf(current).toLowerCase()) shown = items.slice();
    shown = shown.slice(0, 60);
    if (!list) { list = h('div.combo-list', { role: 'listbox' }); wrap.appendChild(list); inp.setAttribute('aria-expanded', 'true'); }
    clear(list);
    idx = Math.min(idx, Math.max(0, shown.length - 1));
    shown.forEach((it, i) => list.appendChild(h('div.combo-opt' + (i === idx ? '.on' : ''), { role: 'option', onmousedown: e => { e.preventDefault(); pick(it.id); } }, h('span', it.label), h('span.g', it.group || ''))));
    if (opts.onCreate && q && !items.some(i => i.label.toLowerCase() === q)) {
      list.appendChild(h('div.combo-opt.new', { onmousedown: async e => { e.preventDefault(); close(); const id = await opts.onCreate(inp.value.trim()); if (id) { items = opts.refresh ? opts.refresh() : items; pick(id); } } }, '+ Create “' + inp.value.trim() + '”'));
    }
    if (!shown.length && !opts.onCreate) list.appendChild(h('div.combo-opt.muted', 'No match'));
  }
  inp.addEventListener('focus', () => { inp.select(); idx = Math.max(0, items.findIndex(i => i.id === current)); render(); });
  inp.addEventListener('input', () => { idx = 0; render(); });
  inp.addEventListener('blur', () => setTimeout(() => { close(); if (inp.value.trim() === '') { if (current && !opts.required) { current = ''; onPick(''); } } else inp.value = labelOf(current); }, 120));
  inp.addEventListener('keydown', e => {
    if (!list && (e.key === 'ArrowDown')) { render(); return; }
    if (!list) return;
    if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, shown.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (shown[idx]) { e.preventDefault(); pick(shown[idx].id); } }
    else if (e.key === 'Escape') { close(); inp.value = labelOf(current); e.stopPropagation(); }
    else if (e.key === 'Tab') { if (shown[idx] && inp.value.trim() && inp.value !== labelOf(current)) pick(shown[idx].id); close(); }
  });
  wrap.appendChild(inp);
  wrap.input = inp;
  wrap.value = () => current;
  wrap.set = id => { current = id; inp.value = labelOf(id); };
  wrap.setItems = it => { items = it; inp.value = labelOf(current); };
  return wrap;
}

/* ---------- table export ---------- */
export function exportTable(name, header, rows) {
  return [
    h('button.btn.sm', { onclick: () => download(name + '.csv', '﻿' + toCSV([header, ...rows]), 'text/csv'), title: 'Download CSV' }, 'CSV'),
    h('button.btn.sm', { onclick: () => exportXlsx(name, header, rows), title: 'Download Excel' }, 'Excel'),
    h('button.btn.sm', { onclick: () => window.print(), title: 'Print or save as PDF' }, 'Print / PDF')
  ];
}
export async function exportXlsx(name, header, rows) {
  const { loadXLSX } = await import('../import/libs.js');
  const XLSX = await loadXLSX();
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 30));
  XLSX.writeFile(wb, name + '.xlsx');
}
/* money cell for exports: rupees as a number */
export const xr = p => Math.round(p) / 100;
