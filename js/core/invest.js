/* Investments engine. Pure. The books stay the single source of truth: every buy, sell, deposit,
   withdrawal and dividend is an ordinary entry carrying meta.inv = { assetId, action, qty, ... }.
   Lots, FIFO cost, holdings and capital gains are worked out from those entries. */
import { rulesFor, termOf } from './taxrules.js';
import { fyOf, fyRange, today, addMonths } from '../lib/dates.js';
import { lineAmt } from './books.js';

/* cls = tax class (see taxrules). units=false means a deposit-type investment tracked in rupees. */
export const ASSET_TYPES = {
  equity: { name: 'Shares (listed)', cls: 'equity', units: true, dp: 0, unit: 'shares', ledger: 'Stocks', priceSrc: 'manual' },
  equity_mf: { name: 'Mutual fund – equity', cls: 'equity', units: true, dp: 3, unit: 'units', ledger: 'Mutual Funds', priceSrc: 'mf' },
  etf: { name: 'ETF – equity', cls: 'equity', units: true, dp: 0, unit: 'units', ledger: 'Stocks', priceSrc: 'manual' },
  debt_mf: { name: 'Mutual fund – debt', cls: 'debt_mf', units: true, dp: 3, unit: 'units', ledger: 'Mutual Funds', priceSrc: 'mf' },
  gold_etf: { name: 'Gold ETF / gold fund', cls: 'other12', units: true, dp: 3, unit: 'units', ledger: 'Gold', priceSrc: 'mf' },
  sgb: { name: 'Sovereign gold bond', cls: 'other12', units: true, dp: 0, unit: 'grams', ledger: 'Gold', priceSrc: 'manual' },
  gold: { name: 'Gold – physical / digital', cls: 'other24', units: true, dp: 3, unit: 'grams', ledger: 'Gold', priceSrc: 'manual' },
  crypto: { name: 'Crypto', cls: 'vda', units: true, dp: 8, unit: 'coins', ledger: 'Crypto (CoinDCX)', priceSrc: 'crypto' },
  bond: { name: 'Bond / debenture (listed)', cls: 'other12', units: true, dp: 0, unit: 'units', ledger: 'Other Investments', priceSrc: 'manual' },
  unlisted: { name: 'Unlisted shares', cls: 'other24', units: true, dp: 0, unit: 'shares', ledger: 'Other Investments', priceSrc: 'manual' },
  property: { name: 'Property / land', cls: 'other24', units: true, dp: 0, unit: 'unit', ledger: 'Real Estate', priceSrc: 'manual', fixed: true },
  fd: { name: 'Fixed deposit', cls: 'interest', units: false, ledger: 'Fixed Deposits' },
  ppf: { name: 'PPF', cls: 'interest', units: false, ledger: 'PPF', exempt: true },
  nps: { name: 'NPS', cls: 'interest', units: false, ledger: 'NPS' },
  other: { name: 'Other investment', cls: 'other24', units: true, dp: 3, unit: 'units', ledger: 'Other Investments', priceSrc: 'manual' }
};
export const typeOf = a => ASSET_TYPES[a.type] || ASSET_TYPES.other;

const EPS = 1e-9;
/* market values and interest estimates are approximations: whole rupees (costs stay exact to the paisa) */
const toRupee = p => Math.round(p / 100) * 100;
export const roundQty = (q, dp = 8) => Math.round(q * 10 ** dp) / 10 ** dp;

/* All investment movements of one asset, oldest first. */
export function assetTxns(vouchers, assetId) {
  return vouchers.filter(v => v.meta && v.meta.inv && v.meta.inv.assetId === assetId)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.meta.inv.action === 'sell') - (b.meta.inv.action === 'sell') || (a.createdAt || '').localeCompare(b.createdAt || ''));
}

/* FIFO over opening lots, buys, sells, splits and bonuses.
   Returns open lots, realised slices (one per lot touched by a sale), and the current holding. */
export function fifo(asset, vouchers, { upto = '' } = {}) {
  const t = typeOf(asset);
  const dp = t.dp ?? 8;
  const events = [];
  for (const l of asset.openingLots || []) events.push({ date: l.date, kind: 'buy', qty: Number(l.qty), cost: l.cost, fmv2018: l.fmv2018 || null, src: 'opening', ref: l.id });
  for (const v of assetTxns(vouchers, asset.id)) {
    const m = v.meta.inv;
    if (m.action === 'buy' && m.qty > 0) events.push({ date: v.date, kind: 'buy', qty: Number(m.qty), cost: m.cost, fmv2018: m.fmv2018 || null, src: 'entry', ref: v.id });
    if (m.action === 'buy' && !(m.qty > 0)) events.push({ date: v.date, kind: 'pending', cost: m.cost, ref: v.id });
    if (m.action === 'sell') events.push({ date: v.date, kind: 'sell', qty: Number(m.qty), proceeds: m.proceeds, ref: v.id });
  }
  for (const e of asset.events || []) events.push({ date: e.date, kind: e.type, ratio: Number(e.ratio), ref: e.id });
  const order = { split: 0, bonus: 1, buy: 2, pending: 2, sell: 3 };
  events.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);

  const lots = [], realised = [], problems = [];
  let pendingCost = 0, pendingCount = 0;
  for (const e of events) {
    if (upto && e.date > upto) break;
    if (e.kind === 'buy') lots.push({ date: e.date, qty: roundQty(e.qty, dp), cost: e.cost, fmv2018: e.fmv2018, origQty: e.qty, src: e.src, ref: e.ref });
    else if (e.kind === 'pending') { pendingCost += e.cost; pendingCount++; }
    else if (e.kind === 'split') for (const l of lots) l.qty = roundQty(l.qty * e.ratio, dp); /* cost unchanged */
    else if (e.kind === 'bonus') {
      /* bonus shares: acquired on the allotment date at nil cost */
      const held = lots.reduce((s, l) => s + l.qty, 0);
      const q = roundQty(held * e.ratio, dp);
      if (q > 0) lots.push({ date: e.date, qty: q, cost: 0, fmv2018: null, src: 'bonus', ref: e.ref });
    } else if (e.kind === 'sell') {
      let need = e.qty, proceedsLeft = e.proceeds;
      const total = e.qty;
      while (need > EPS && lots.length) {
        const l = lots[0];
        const take = Math.min(l.qty, need);
        const whole = Math.abs(take - l.qty) < EPS;
        const cost = whole ? l.cost : Math.round(l.cost * take / l.qty);
        const fmv = l.fmv2018 ? (whole ? l.fmv2018 : Math.round(l.fmv2018 * take / l.qty)) : null;
        need = roundQty(need - take, dp);
        const proceeds = need <= EPS ? proceedsLeft : Math.round(e.proceeds * take / total);
        proceedsLeft -= proceeds;
        realised.push({ sellRef: e.ref, sellDate: e.date, buyDate: l.date, qty: roundQty(take, dp), cost, proceeds, fmv2018: fmv, lotSrc: l.src });
        if (whole) lots.shift(); else { l.qty = roundQty(l.qty - take, dp); l.cost -= cost; if (l.fmv2018) l.fmv2018 -= fmv; }
      }
      if (need > EPS) problems.push({ ref: e.ref, date: e.date, text: `Sold ${roundQty(need, dp)} more than held on ${e.date}.` });
    }
  }
  const qty = roundQty(lots.reduce((s, l) => s + l.qty, 0), dp);
  const cost = lots.reduce((s, l) => s + l.cost, 0);
  return { lots, realised, qty, cost, avg: qty > EPS ? cost / qty : 0, pendingCost, pendingCount, problems };
}

/* Tax view of one realised slice. Grandfathering: listed equity bought on or before 31 Jan 2018
   uses the higher of cost and (lower of FMV on 31 Jan 2018 and sale value). */
export function classify(asset, slice) {
  const t = typeOf(asset);
  const taxYear = fyOf(slice.sellDate);
  const rules = rulesFor(taxYear);
  const term = termOf(t.cls, rules, slice.buyDate, slice.sellDate);
  let taxCost = slice.cost;
  if (t.cls === 'equity' && term === 'long' && slice.buyDate <= '2018-01-31' && slice.fmv2018) taxCost = Math.max(slice.cost, Math.min(slice.fmv2018, slice.proceeds));
  const r = rules[t.cls] || rules.other24;
  const ledgerKey = term === 'long' ? r.ltLedger : r.stLedger;
  return { ...slice, cls: t.cls, term, taxYear, gain: slice.proceeds - slice.cost, taxGain: slice.proceeds - taxCost, taxCost, ledgerKey };
}

/* Deposit-type investments (FD, PPF, NPS): book value from their entries, value manual or accrued. */
export function depositState(asset, vouchers, upto = today()) {
  let invested = 0, interest = 0, withdrawn = 0;
  for (const v of assetTxns(vouchers, asset.id)) {
    if (v.date > upto) continue;
    const m = v.meta.inv;
    if (m.action === 'deposit') invested += m.amount;
    else if (m.action === 'interest' && m.reinvested) interest += m.amount;
    else if (m.action === 'withdraw') withdrawn += m.cost;
  }
  invested += asset.openingAmount || 0;
  const book = invested + interest - withdrawn;
  return { invested, interest, withdrawn, book, closed: !!asset.closed };
}
/* FD value estimate: quarterly compounding from the start date (what banks quote). */
export function fdAccrued(asset, onDate = today()) {
  const fd = asset.fd || {};
  if (!fd.principal || !fd.rate || !fd.start) return null;
  const end = fd.maturity && fd.maturity < onDate ? fd.maturity : onDate;
  const years = Math.max(0, (Date.parse(end) - Date.parse(fd.start)) / (365.25 * 864e5));
  const v = fd.payout === 'payout' ? fd.principal : Math.round(fd.principal * Math.pow(1 + fd.rate / 400, 4 * years));
  return v;
}

/* One row per asset for the portfolio page. */
export function valueAsset(asset, vouchers, onDate = today()) {
  const t = typeOf(asset);
  if (!t.units) {
    const d = depositState(asset, vouchers, onDate);
    const acc = asset.type === 'fd' ? fdAccrued(asset, onDate) : null;
    const value = asset.closed ? 0 : (asset.value && asset.valueDate ? asset.value : acc != null ? toRupee(acc) : d.book);
    return { asset, type: t, qty: null, cost: asset.closed ? 0 : d.book, value, gain: value - (asset.closed ? 0 : d.book), ltQty: null, deposit: d, realisedThisYear: 0 };
  }
  const f = fifo(asset, vouchers, { upto: onDate });
  const price = asset.price || 0;
  const value = price ? toRupee(f.qty * price) : f.cost;
  const rules = rulesFor(fyOf(onDate));
  const ltQty = f.lots.filter(l => termOf(t.cls, rules, l.date, onDate) === 'long').reduce((s, l) => s + l.qty, 0);
  const fy = fyRange(fyOf(onDate));
  const realisedThisYear = f.realised.filter(r => r.sellDate >= fy.from && r.sellDate <= fy.to).reduce((s, r) => s + r.proceeds - r.cost, 0);
  return { asset, type: t, qty: f.qty, cost: f.cost + f.pendingCost, value: value + f.pendingCost, gain: value - f.cost, ltQty, fifo: f, priced: !!price, realisedThisYear };
}

/* The ledger lines a sale should carry: Dr money (net), Cr investment (FIFO cost), gains split by term. */
export function saleLines({ asset, vouchers, sellRef, date, qty, proceeds, moneyLedgerId, investLedgerId, gainLedgerFor }) {
  const probe = { ...asset };
  const others = vouchers.filter(v => v.id !== sellRef);
  const fake = { id: sellRef || '__sale__', date, createdAt: '9999', meta: { inv: { assetId: asset.id, action: 'sell', qty, proceeds } }, lines: [] };
  const f = fifo(probe, [...others, fake]);
  const slices = f.realised.filter(r => r.sellRef === fake.id).map(s => classify(asset, s));
  const cost = slices.reduce((s, x) => s + x.cost, 0);
  const byLedger = new Map();
  for (const s of slices) byLedger.set(s.ledgerKey, (byLedger.get(s.ledgerKey) || 0) + s.gain);
  const lines = [{ ledgerId: moneyLedgerId, dr: proceeds, cr: 0 }, { ledgerId: investLedgerId, dr: 0, cr: cost }];
  for (const [key, g] of byLedger) if (g) lines.push(g > 0 ? { ledgerId: gainLedgerFor(key), dr: 0, cr: g } : { ledgerId: gainLedgerFor(key), dr: -g, cr: 0 });
  const short = f.problems.find(p => p.ref === fake.id);
  return { lines, slices, cost, gain: proceeds - cost, problem: short ? short.text : '' };
}

/* Capital gains for a tax year across assets, with the basic set-off and an estimate at special rates. */
export function capitalGains(assets, vouchers, taxYear) {
  const { from, to } = fyRange(taxYear);
  const rules = rulesFor(taxYear);
  const rows = [];
  for (const a of assets) {
    if (!typeOf(a).units) continue;
    for (const s of fifo(a, vouchers).realised) if (s.sellDate >= from && s.sellDate <= to) rows.push({ asset: a, ...classify(a, s) });
  }
  const bucket = (cls, term) => rows.filter(r => r.cls === cls && r.term === term).reduce((s, r) => s + r.taxGain, 0);
  const b = {
    eqST: bucket('equity', 'short'), eqLT: bucket('equity', 'long'),
    othST: ['other12', 'other24', 'debt_mf'].reduce((s, c) => s + bucket(c, 'short'), 0),
    othLT: ['other12', 'other24', 'debt_mf'].reduce((s, c) => s + bucket(c, 'long'), 0),
    vda: rows.filter(r => r.cls === 'vda').reduce((s, r) => s + Math.max(0, r.taxGain), 0),
    vdaLoss: rows.filter(r => r.cls === 'vda').reduce((s, r) => s + Math.min(0, r.taxGain), 0)
  };
  /* set-off within the year: short-term losses against any gain; long-term losses only against long-term gains */
  let stLoss = Math.max(0, -b.eqST) + Math.max(0, -b.othST);
  let ltLoss = Math.max(0, -b.eqLT) + Math.max(0, -b.othLT);
  let eqST = Math.max(0, b.eqST), othST = Math.max(0, b.othST), eqLT = Math.max(0, b.eqLT), othLT = Math.max(0, b.othLT);
  const use = (gain, loss) => { const u = Math.min(gain, loss); return [gain - u, loss - u]; };
  [othST, stLoss] = use(othST, stLoss); [eqST, stLoss] = use(eqST, stLoss);
  [othLT, ltLoss] = use(othLT, ltLoss); [eqLT, ltLoss] = use(eqLT, ltLoss);
  [othLT, stLoss] = use(othLT, stLoss); [eqLT, stLoss] = use(eqLT, stLoss);
  const eq = rules.equity;
  const exempt = Math.min(eqLT, eq.ltExempt);
  const taxable = { eqST, eqLT: eqLT - exempt, othST, othLT, vda: b.vda };
  const tax = {
    eqST: Math.round(taxable.eqST * eq.stRate), eqLT: Math.round(taxable.eqLT * eq.ltRate),
    othLT: Math.round(taxable.othLT * rules.other24.ltRate), vda: Math.round(taxable.vda * rules.vda.flatRate)
  };
  return { taxYear, rows: rows.sort((x, y) => x.sellDate.localeCompare(y.sellDate)), buckets: b, afterSetoff: { eqST, eqLT, othST, othLT }, exempt, taxable, tax,
    taxSpecial: tax.eqST + tax.eqLT + tax.othLT + tax.vda, carryForward: { shortTerm: stLoss, longTerm: ltLoss } };
}

/* F&O / intraday summary. Turnover for audit: absolute profit + loss per trade summary, plus option premium received. */
export function tradingSummary(vouchers, taxYear) {
  const { from, to } = fyRange(taxYear);
  const seg = {};
  for (const v of vouchers) {
    const m = v.meta && v.meta.trade; if (!m || v.date < from || v.date > to) continue;
    const s = seg[m.segment] || (seg[m.segment] = { segment: m.segment, count: 0, profit: 0, loss: 0, charges: 0, turnover: 0, stt: 0 });
    s.count++;
    if (m.pl >= 0) s.profit += m.pl; else s.loss += -m.pl;
    s.charges += m.charges || 0; s.stt += m.stt || 0;
    s.turnover += Math.abs(m.pl) + (m.premium || 0);
  }
  const list = Object.values(seg);
  for (const s of list) s.net = s.profit - s.loss - s.charges;
  return { segments: list, turnover: list.filter(s => s.segment !== 'intraday').reduce((t, s) => t + s.turnover, 0), net: list.reduce((t, s) => t + s.net, 0) };
}

/* Money in an investment account that is not linked to any investment (e.g. an opening balance). */
export function unlinked(ctx, assets, valuations) {
  const out = [];
  const bal = new Map();
  for (const v of ctx.vouchers) for (const ln of v.lines) bal.set(ln.ledgerId, (bal.get(ln.ledgerId) || 0) + lineAmt(ln));
  for (const l of ctx.ledgers) {
    /* only accounts that hold investments (not e.g. cash lying with the broker) */
    const typical = Object.values(ASSET_TYPES).some(t => t.ledger === l.name);
    if (!assets.some(a => a.ledgerId === l.id) && !typical) continue;
    const books = (l.opening || 0) + (bal.get(l.id) || 0);
    const linked = valuations.filter(x => x.asset.ledgerId === l.id).reduce((s, x) => s + x.cost, 0);
    if (books !== linked) out.push({ ledger: l, books, linked, diff: books - linked });
  }
  return out;
}
export const LT_DATE = (cls, rules, buyDate) => { const r = rules[cls]; return r && r.ltMonths ? addMonths(buyDate, r.ltMonths) : ''; };

/* ---------- avoiding double entry ----------
   Money can reach an investment account from a bank-statement import, a transfer or the old app without saying
   which investment it bought. Those entries are listed so they can be LINKED (the same entry gains the
   investment details) instead of a second entry being added. */
export function investmentLedgerIds(ctx, assets) {
  const typical = new Set(Object.values(ASSET_TYPES).map(t => t.ledger));
  const used = new Set(assets.filter(a => a.entityId === ctx.entity.id).map(a => a.ledgerId));
  return new Set(ctx.ledgers.filter(l => used.has(l.id) || typical.has(l.name) || ctx.natureOf(l) === 'investment').map(l => l.id));
}
export function unlinkedEntries(ctx, assets) {
  const inv = investmentLedgerIds(ctx, assets);
  const out = [];
  for (const v of ctx.vouchers) {
    if ((v.meta && (v.meta.inv || v.meta.trade)) || v.src === 'family') continue;
    const byLedger = new Map();
    for (const ln of v.lines) if (inv.has(ln.ledgerId)) byLedger.set(ln.ledgerId, (byLedger.get(ln.ledgerId) || 0) + lineAmt(ln));
    for (const [ledgerId, net] of byLedger) {
      if (!net) continue;
      out.push({ voucher: v, ledgerId, amount: Math.abs(net), dir: net > 0 ? 'in' : 'out', date: v.date });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
/* entries that look like the same money as a purchase being typed in (same amount, within a few days) */
export function sameMoney(ctx, assets, { amount, date, days = 5 }) {
  const lo = new Date(Date.parse(date) - days * 864e5).toISOString().slice(0, 10);
  const hi = new Date(Date.parse(date) + days * 864e5).toISOString().slice(0, 10);
  return unlinkedEntries(ctx, assets).filter(u => u.dir === 'in' && u.amount === amount && u.date >= lo && u.date <= hi);
}
/* Turn an existing entry into a purchase / deposit of `asset`. The money side is untouched; the investment
   line moves to the asset's account if it was booked to another investment account. */
export function linkAsPurchase(voucher, ledgerId, asset, qty) {
  const t = typeOf(asset);
  const amount = voucher.lines.filter(l => l.ledgerId === ledgerId).reduce((s, l) => s + lineAmt(l), 0);
  const lines = voucher.lines.map(l => (l.ledgerId === ledgerId ? { ...l, ledgerId: asset.ledgerId } : l));
  const inv = t.units ? { assetId: asset.id, action: 'buy', qty: qty > 0 ? qty : 0, cost: amount, price: qty > 0 ? Math.round(amount / qty) : 0, charges: 0, linked: true }
    : { assetId: asset.id, action: 'deposit', amount, linked: true };
  return { ...voucher, lines, meta: { ...(voucher.meta || {}), inv } };
}
