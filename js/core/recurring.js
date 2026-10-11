/* Recurring entries (EMI, SIP, rent, salary). Due instances are offered for posting, never posted silently. */
import { addMonths, addDays } from '../lib/dates.js';

export const FREQS = {
  weekly: { name: 'Weekly' },
  monthly: { name: 'Monthly', months: 1 },
  quarterly: { name: 'Quarterly', months: 3 },
  halfyearly: { name: 'Half-yearly', months: 6 },
  yearly: { name: 'Yearly', months: 12 }
};

/* All due dates after lastPosted (exclusive) up to `upto` (inclusive), respecting endDate. */
export function dueDates(rec, upto, limit = 120) {
  const out = [];
  if (!rec || rec.paused) return out;
  const day = Number(rec.startDate.slice(8, 10));
  let d = rec.startDate, i = 0;
  while (d <= upto && out.length < limit && i < 2000) {
    if ((!rec.endDate || d <= rec.endDate) && (!rec.lastPosted || d > rec.lastPosted)) out.push(d);
    i++;
    d = rec.freq === 'weekly' ? addDays(rec.startDate, 7 * i) : addMonths(rec.startDate, (FREQS[rec.freq] || FREQS.monthly).months * i, day);
  }
  return out;
}
