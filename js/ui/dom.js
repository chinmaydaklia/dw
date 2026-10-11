/* Minimal DOM helpers: h('div.card#id', {onclick, class, ...}, children...) */
import { formatINR, formatCompact } from '../lib/money.js';
import { S } from '../app/store.js';

export function h(sel, attrs, ...kids) {
  if (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof el[k] === 'boolean') el[k] = !!v; /* disabled, checked, multiple… */
    else if (k in el && k !== 'list' && k !== 'form' && typeof v !== 'string') el[k] = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
/* Safe append: skips null/false and flattens arrays (native Element.append would print them). */
export function add(el, ...kids) { append(el, kids); return el; }
export const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (s, root = document) => root.querySelector(s);

/* Money display. Respects the hide-amounts toggle; in/out shown with sign AND colour. */
const MASK = '₹ ••••';
export function money(p, opts = {}) {
  if (S.settings.hideAmounts) return MASK;
  return opts.compact ? formatCompact(p) : formatINR(p, opts);
}
export function amt(p, opts = {}) {
  const cls = opts.flow ? (p > 0 ? 'in' : p < 0 ? 'out' : '') : (opts.cls || '');
  return h('span.amt' + (cls ? '.' + cls : ''), money(p, { sign: !!opts.flow, ...opts }));
}
/* Dr/Cr balance: "₹1,200 Dr" */
export function drcr(p) {
  if (S.settings.hideAmounts) return MASK;
  if (!p) return '₹0';
  return formatINR(Math.abs(p)) + (p > 0 ? ' Dr' : ' Cr');
}
export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export function pickFile(accept, multiple = false) {
  return new Promise(resolve => {
    const inp = h('input', { type: 'file', accept, multiple });
    inp.addEventListener('change', () => resolve(multiple ? [...inp.files] : inp.files[0] || null));
    inp.click();
  });
}
export const readText = f => f.text();
export const readBuffer = f => f.arrayBuffer();
