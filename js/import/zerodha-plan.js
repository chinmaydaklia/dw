/* Zerodha P&L → entries, without double counting. Pure.
   Shares / funds: if Portfolio already holds enough, only the SALE is added (your own purchases and FIFO are used);
   otherwise the PURCHASE is added too, paid from the Zerodha wallet. F&O / intraday: one trading result per day per segment.
   Ledger ids that do not exist yet are returned as keys (e.g. 'gain_eq_lt') for the caller to create and swap in. */
import { DELIVERY_KINDS } from './zerodha.js';
import { fifo, saleLines } from '../core/invest.js';
import { newVoucher, tidyLines } from '../core/vouchers.js';
import { uid, nowISO } from '../lib/util.js';

export function matchAsset(assets, row) {
  const sym = row.symbol.toUpperCase();
  return assets.find(a => row.isin && a.isin && a.isin.toUpperCase() === row.isin.toUpperCase())
    || assets.find(a => (a.symbol || '').toUpperCase() === sym || a.name.toUpperCase() === sym) || null;
}
export function assetTypeFor(row) {
  if (row.kind === 'mf') return 'equity_mf';
  if (row.kind === 'nonequity') return 'etf_other';
  return /BEES$|ETF$|IETF$/i.test(row.symbol) ? 'etf' : 'equity';
}
const segmentOf = row => (row.kind === 'intraday' ? 'intraday' : /\d(CE|PE)$|\b(CE|PE)\b/i.test(row.symbol) ? 'options' : 'futures');

export function planZerodhaPnl(ctx, assets, rows) {
  const delivery = [], tradeMap = new Map();
  const mine = assets.filter(a => a.entityId === ctx.entity.id);
  const left = new Map(); /* asset id -> quantity Portfolio still holds for later rows of this file */
  for (const r of rows.filter(x => DELIVERY_KINDS.has(x.kind)).sort((a, b) => a.exit.localeCompare(b.exit))) {
    const a = matchAsset(mine, r);
    let action = 'buy+sell', dup = false;
    if (a) {
      dup = ctx.vouchers.some(v => v.meta && v.meta.inv && v.meta.inv.assetId === a.id && v.meta.inv.action === 'sell' && v.date === r.exit && Math.abs(v.meta.inv.qty - r.qty) < 1e-9);
      if (!left.has(a.id)) left.set(a.id, fifo(a, ctx.vouchers, { upto: r.exit }).qty);
      if (!dup && left.get(a.id) >= r.qty - 1e-9) { action = 'sell-only'; left.set(a.id, left.get(a.id) - r.qty); }
    }
    delivery.push({ row: r, asset: a, action, dup, include: !dup });
  }
  for (const r of rows.filter(x => !DELIVERY_KINDS.has(x.kind))) {
    const seg = segmentOf(r), key = seg + '|' + r.exit;
    const t = tradeMap.get(key) || { segment: seg, date: r.exit, pl: 0, charges: 0, stt: 0, turnover: 0, count: 0, symbols: [] };
    t.pl += r.profit; t.charges += r.charges + r.stt; t.stt += r.stt; t.turnover += r.turnover || Math.abs(r.profit); t.count++;
    if (t.symbols.length < 4) t.symbols.push(r.symbol);
    tradeMap.set(key, t);
  }
  const trades = [...tradeMap.values()].sort((a, b) => a.date.localeCompare(b.date) || a.segment.localeCompare(b.segment)).map(t => {
    const dup = ctx.vouchers.some(v => v.meta && v.meta.trade && v.meta.trade.segment === t.segment && v.date === t.date && v.meta.trade.pl === t.pl);
    return { ...t, dup, include: !dup };
  });
  return { delivery, trades };
}

/* Build the entries. opts: { walletId, ledgerForType: type -> ledgerId, sttLedgerId, batchId } */
export function buildZerodhaPostings(ctx, assets, plan, opts) {
  const eid = ctx.entity.id;
  const newAssets = [], vouchers = [];
  const pool = ctx.vouchers.slice();
  const assetFor = new Map();
  const sells = [];
  let deliverySTT = 0, lastDate = '';
  for (const d of plan.delivery.filter(x => x.include)) {
    const r = d.row;
    let a = d.asset || assetFor.get((r.isin || r.symbol).toUpperCase());
    if (!a) {
      const type = assetTypeFor(r);
      a = { id: uid('ast'), entityId: eid, name: r.symbol, type, symbol: r.symbol.toUpperCase(), isin: r.isin || '', ledgerId: opts.ledgerForType(type), price: 0, priceDate: '', openingLots: [], events: [], archived: false, closed: false, createdAt: nowISO(), updatedAt: nowISO(), source: 'zerodha-pnl' };
      newAssets.push(a); assetFor.set((r.isin || r.symbol).toUpperCase(), a);
    }
    if (d.action === 'buy+sell') {
      const buyDate = r.entry || r.exit;
      const v = newVoucher(eid, { type: 'payment', src: 'investment', date: buyDate, narration: `Bought ${r.symbol} (Zerodha P&L)`, batchId: opts.batchId,
        lines: tidyLines([{ ledgerId: a.ledgerId, dr: r.buy }, { ledgerId: opts.walletId, cr: r.buy }]),
        meta: { inv: { assetId: a.id, action: 'buy', qty: r.qty, cost: r.buy, price: Math.round(r.buy / r.qty), charges: 0, fmv2018: buyDate <= '2018-01-31' ? r.fmv || 0 : 0, source: 'zerodha-pnl' } } });
      vouchers.push(v); pool.push(v);
    }
    sells.push({ r, a });
    deliverySTT += r.stt;
    if (r.exit > lastDate) lastDate = r.exit;
  }
  const allAssets = [...assets, ...newAssets];
  let problems = [];
  for (const { r, a } of sells.sort((x, y) => x.r.exit.localeCompare(y.r.exit))) {
    /* brokerage and exchange charges reduce the sale value; STT is not allowed against capital gains, so it is booked separately */
    const proceeds = r.sell - r.charges;
    const s = saleLines({ asset: a, vouchers: pool, date: r.exit, qty: r.qty, proceeds, moneyLedgerId: opts.walletId, investLedgerId: a.ledgerId, gainLedgerFor: k => k });
    if (s.problem) problems.push(r.symbol + ': ' + s.problem);
    const v = newVoucher(eid, { type: 'receipt', src: 'investment', date: r.exit, narration: `Sold ${r.symbol} (Zerodha P&L)`, batchId: opts.batchId, lines: s.lines,
      meta: { inv: { assetId: a.id, action: 'sell', qty: r.qty, proceeds, gross: r.sell, charges: r.charges, price: Math.round(r.sell / r.qty), source: 'zerodha-pnl', zerodhaProfit: r.profit } } });
    vouchers.push(v); pool.push(v);
  }
  if (deliverySTT) vouchers.push(newVoucher(eid, { type: 'payment', src: 'investment', date: lastDate, narration: 'STT on share / fund sales (Zerodha P&L)', batchId: opts.batchId,
    lines: tidyLines([{ ledgerId: opts.sttLedgerId, dr: deliverySTT }, { ledgerId: opts.walletId, cr: deliverySTT }]) }));
  for (const t of plan.trades.filter(x => x.include)) {
    const plKey = t.segment === 'intraday' ? 'trade_intraday' : 'trade_fo';
    const net = t.pl - t.charges;
    const lines = tidyLines([t.pl > 0 ? { ledgerId: plKey, cr: t.pl } : t.pl < 0 ? { ledgerId: plKey, dr: -t.pl } : null, t.charges ? { ledgerId: 'trade_charges', dr: t.charges } : null,
      net > 0 ? { ledgerId: opts.walletId, dr: net } : net < 0 ? { ledgerId: opts.walletId, cr: -net } : null].filter(Boolean));
    if (lines.length < 2) continue;
    vouchers.push(newVoucher(eid, { type: net >= 0 ? 'receipt' : 'payment', src: 'trading', date: t.date, narration: `${t.segment === 'intraday' ? 'Intraday' : 'F&O ' + t.segment} – ${t.count} trade(s) (Zerodha P&L)`, batchId: opts.batchId, lines,
      meta: { trade: { segment: t.segment, pl: t.pl, charges: t.charges, stt: t.stt, premium: Math.max(0, t.turnover - Math.abs(t.pl)), source: 'zerodha-pnl' } } }));
  }
  return { newAssets, vouchers, problems, allAssets };
}
