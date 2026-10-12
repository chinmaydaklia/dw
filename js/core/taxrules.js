/* Capital-gains rules by tax year. Data, not code: a future Budget edits this table.
   Positions per the blueprint's verified rules (Budget 2026 made no change). Items still marked
   "confirm" in the blueprint's open list (gold / unlisted / debt holding periods) are flagged in the UI. */
import { addMonths } from '../lib/dates.js';

const Y2026 = {
  /* listed shares, equity mutual funds, equity ETFs */
  equity: { label: 'Listed shares & equity funds', ltMonths: 12, stRate: 0.20, ltRate: 0.125, ltExempt: 1_25_000_00, stLedger: 'gain_eq_st', ltLedger: 'gain_eq_lt' },
  /* other listed securities: gold ETF / SGB on exchange, listed bonds */
  other12: { label: 'Other listed investments', ltMonths: 12, stRate: null, ltRate: 0.125, stLedger: 'gain_oth_st', ltLedger: 'gain_oth_lt', confirm: true },
  /* physical / digital gold, unlisted shares, property, other assets */
  other24: { label: 'Gold, property, unlisted & other', ltMonths: 24, stRate: null, ltRate: 0.125, stLedger: 'gain_oth_st', ltLedger: 'gain_oth_lt', confirm: true },
  /* debt funds bought on/after 1 Apr 2023: always short term, taxed at slab */
  debt_mf: { label: 'Debt mutual funds', ltMonths: null, stRate: null, ltRate: 0.125, stLedger: 'gain_oth_st', ltLedger: 'gain_oth_lt', alwaysShortFrom: '2023-04-01', oldLtMonths: 24, confirm: true },
  /* crypto: flat 30%, only cost deductible, losses never set off or carried forward */
  vda: { label: 'Crypto', ltMonths: null, flatRate: 0.30, stLedger: 'gain_vda', ltLedger: 'gain_vda', noSetoff: true }
};
export const CG_RULES = { '2024-25': Y2026, '2025-26': Y2026, '2026-27': Y2026 };
export const rulesFor = taxYear => CG_RULES[taxYear] || CG_RULES['2026-27'];
export const CESS = 0.04;
/* F&O audit: turnover above ₹10 crore (when digital receipts/payments ≥ 95%); otherwise ask the CA */
export const FO_AUDIT_TURNOVER = 10_00_00_000_00;

/* Short or long term for one sale of one lot. */
export function termOf(cls, rules, buyDate, sellDate) {
  const r = rules[cls];
  if (!r) return 'short';
  if (cls === 'vda') return 'flat';
  if (cls === 'debt_mf') {
    if (buyDate >= r.alwaysShortFrom) return 'short';
    return addMonths(buyDate, r.oldLtMonths) < sellDate ? 'long' : 'short';
  }
  return addMonths(buyDate, r.ltMonths) < sellDate ? 'long' : 'short';
}
