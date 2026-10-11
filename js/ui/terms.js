/* Wording. Plain language by default; the "For my CA" pages switch to formal accounting terms. */
import { S } from '../app/store.js';
import { GROUP_TEMPLATE, SYSTEM_NAMES } from '../core/masters.js';

let forced = false;
/* the CA pages call this while they render */
export function caView(on) { forced = !!on; }
export const isCA = () => forced || !!S.settings.caMode;
export const t = (plain, ca) => (isCA() ? ca : plain);

const GROUP_CA = Object.fromEntries(GROUP_TEMPLATE.map(g => [g.key, g]));
export function groupName(g) {
  if (!g) return '';
  const tpl = g.key && GROUP_CA[g.key];
  return isCA() && tpl && g.name === tpl.name ? tpl.caName : g.name;
}
export function ledgerName(l) {
  if (!l) return '?';
  const sys = SYSTEM_NAMES[l.system];
  return isCA() && sys && l.name === sys.name ? sys.caName : l.name;
}
/* Plain entry kinds instead of Receipt / Payment / Contra / Journal */
const KIND = { receipt: ['Money in', 'Receipt'], payment: ['Money out', 'Payment'], contra: ['Transfer', 'Contra'], journal: ['Adjustment', 'Journal'] };
export const kindName = type => t(...(KIND[type] || KIND.journal));
