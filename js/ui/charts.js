/* Small SVG charts: grouped bars (income vs expense) and a line (net worth).
   Thin marks, rounded data ends, recessive grid, hover tooltip, legend for 2 series. */
import { h } from './dom.js';
import { money } from './dom.js';
import { formatCompact } from '../lib/money.js';
import { S } from '../app/store.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); kids.forEach(k => k && el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k)); return el; };
const tick = v => (S.settings.hideAmounts ? '' : formatCompact(v).replace('₹', ''));
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }
/* rect with only the top corners rounded (data end), anchored to the baseline */
function barPath(x, y, w, hgt, r) { r = Math.min(r, w / 2, hgt); return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`; }

/* data: [{ label, a, b }], names: [aName, bName] */
export function barChart(data, names) {
  const W = 640, H = 220, P = { l: 44, r: 8, t: 10, b: 24 };
  const max = niceMax(Math.max(1, ...data.flatMap(d => [d.a, d.b])));
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const band = iw / Math.max(1, data.length), bw = Math.max(3, Math.min(16, band / 2 - 4));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': names.join(' and ') + ' by month' });
  for (let i = 0; i <= 4; i++) {
    const y = P.t + ih - (ih * i) / 4;
    svg.append(s('line', { class: 'grid-l', x1: P.l, x2: W - P.r, y1: y, y2: y }), s('text', { class: 'axis', x: P.l - 6, y: y + 3, 'text-anchor': 'end' }, tick((max * i) / 4)));
  }
  const tip = h('div.tip');
  const wrap = h('div.chart', h('div.legend', h('span', h('i', { style: { background: 'var(--series-in)' } }), names[0]), h('span', h('i', { style: { background: 'var(--series-out)' } }), names[1])), svg, tip);
  data.forEach((d, i) => {
    const x0 = P.l + band * i + band / 2;
    const ha = (d.a / max) * ih, hb = (d.b / max) * ih;
    if (ha > 0) svg.append(s('path', { class: 'bar-in', d: barPath(x0 - bw - 1, P.t + ih - ha, bw, ha, 4) }));
    if (hb > 0) svg.append(s('path', { class: 'bar-out', d: barPath(x0 + 1, P.t + ih - hb, bw, hb, 4) }));
    svg.append(s('text', { class: 'axis', x: x0, y: H - 6, 'text-anchor': 'middle' }, d.label));
    const hit = s('rect', { class: 'hit', x: P.l + band * i, y: P.t, width: band, height: ih });
    hit.addEventListener('mousemove', e => {
      tip.style.display = 'block';
      tip.replaceChildren(h('b', d.label), h('div', names[0] + ': ' + money(d.a)), h('div', names[1] + ': ' + money(d.b)), h('div.muted', 'Net: ' + money(d.a - d.b, { sign: true })));
      const r = wrap.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      tip.style.left = Math.min(x + 12, r.width - 150) + 'px'; tip.style.top = (y - 10) + 'px';
    });
    hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    svg.append(hit);
  });
  return wrap;
}

/* points: [{ label, value }] single series, title names it */
export function lineChart(points) {
  const W = 640, H = 200, P = { l: 48, r: 10, t: 10, b: 24 };
  const vals = points.map(p => p.value);
  let lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
  hi = niceMax(hi); if (lo < 0) lo = -niceMax(-lo);
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const X = i => P.l + (points.length < 2 ? iw / 2 : (iw * i) / (points.length - 1));
  const Y = v => P.t + ih - ((v - lo) / (hi - lo)) * ih;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Net worth by month' });
  for (let i = 0; i <= 4; i++) { const v = lo + ((hi - lo) * i) / 4, y = Y(v); svg.append(s('line', { class: 'grid-l', x1: P.l, x2: W - P.r, y1: y, y2: y }), s('text', { class: 'axis', x: P.l - 6, y: y + 3, 'text-anchor': 'end' }, tick(v))); }
  if (points.length) {
    const d = points.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p.value).toFixed(1)).join('');
    svg.append(s('path', { class: 'area', d: d + `L${X(points.length - 1)},${Y(Math.max(lo, 0))}L${X(0)},${Y(Math.max(lo, 0))}Z` }), s('path', { class: 'line', d }));
    const step = Math.ceil(points.length / 12);
    points.forEach((p, i) => { if (i % step === 0 || i === points.length - 1) svg.append(s('text', { class: 'axis', x: X(i), y: H - 6, 'text-anchor': 'middle' }, p.label)); });
  }
  const tip = h('div.tip');
  const dot = s('circle', { r: 4, fill: 'var(--series-in)', stroke: 'var(--surface)', 'stroke-width': 2, style: 'display:none' });
  const vline = s('line', { class: 'grid-l', y1: P.t, y2: P.t + ih, style: 'display:none' });
  svg.append(vline, dot);
  const wrap = h('div.chart', svg, tip);
  const hit = s('rect', { class: 'hit', x: P.l, y: P.t, width: iw, height: ih });
  hit.addEventListener('mousemove', e => {
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((sx - P.l) / iw) * (points.length - 1))));
    const p = points[i]; if (!p) return;
    dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(p.value)); dot.style.display = '';
    vline.setAttribute('x1', X(i)); vline.setAttribute('x2', X(i)); vline.style.display = '';
    tip.style.display = 'block'; tip.replaceChildren(h('b', p.label), h('div', money(p.value)));
    const wr = wrap.getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - wr.left + 12, wr.width - 130) + 'px'; tip.style.top = (e.clientY - wr.top - 10) + 'px';
  });
  hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; dot.style.display = 'none'; vline.style.display = 'none'; });
  svg.append(hit);
  return wrap;
}
