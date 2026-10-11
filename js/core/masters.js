/* Chart of accounts: root types, group templates, starter ledgers and tax tags.
   Everything here is a TEMPLATE copied into each entity, then freely editable.
   Records always point at permanent ids, so renaming never breaks history. */
import { uid, nowISO } from '../lib/util.js';

export const ROOTS = {
  asset: { name: 'Assets', side: 'dr' },
  liability: { name: 'Liabilities', side: 'cr' },
  capital: { name: 'Capital', side: 'cr' },
  income: { name: 'Income', side: 'cr' },
  expense: { name: 'Expenses', side: 'dr' }
};
export const ROOT_ORDER = ['asset', 'liability', 'capital', 'income', 'expense'];

/* nature drives behaviour: cash/bank are "money" ledgers (contra, cash flow, cash-vs-digital); card is a
   money-like liability used for payments. */
/* name = plain wording shown by default; caName = formal accounting name shown in the CA view */
export const GROUP_TEMPLATE = [
  { key: 'bank', name: 'Bank accounts', caName: 'Bank Accounts', root: 'asset', nature: 'bank' },
  { key: 'cash', name: 'Cash', caName: 'Cash-in-Hand', root: 'asset', nature: 'cash' },
  { key: 'invest', name: 'Investments', caName: 'Investments', root: 'asset', nature: 'investment' },
  { key: 'advances', name: 'Money lent to others', caName: 'Loans & Advances (Asset)', root: 'asset', nature: 'advance' },
  { key: 'taxassets', name: 'Tax paid & TDS', caName: 'Taxes Paid & TDS', root: 'asset', nature: 'taxasset' },
  { key: 'fixed', name: 'Car, equipment & property', caName: 'Fixed Assets', root: 'asset', nature: 'fixed' },
  { key: 'loans', name: 'Loans I have taken', caName: 'Loans (Liability)', root: 'liability', nature: 'loan' },
  { key: 'cards', name: 'Credit cards', caName: 'Credit Cards', root: 'liability', nature: 'card' },
  { key: 'curliab', name: 'Bills to pay & unsorted', caName: 'Current Liabilities', root: 'liability', nature: 'payable' },
  { key: 'capital', name: 'Net worth & family gifts', caName: 'Capital Account', root: 'capital', nature: 'capital' },
  { key: 'profinc', name: 'Practice income', caName: 'Professional Receipts', root: 'income', nature: 'profincome' },
  { key: 'othinc', name: 'Other income', caName: 'Other Income', root: 'income', nature: 'otherincome' },
  { key: 'profexp', name: 'Practice expenses', caName: 'Professional Expenses', root: 'expense', nature: 'profexpense' },
  { key: 'finexp', name: 'Loan interest & bank charges', caName: 'Finance Costs', root: 'expense', nature: 'finance' },
  { key: 'personal', name: 'Personal & home', caName: 'Personal & Household', root: 'expense', nature: 'personal' }
];
/* old (v1) names, used once to rename built-in groups the user has not renamed */
export const OLD_GROUP_NAMES = { bank: 'Bank Accounts', cash: 'Cash-in-Hand', advances: 'Loans & Advances (Asset)', taxassets: 'Taxes Paid & TDS', fixed: 'Fixed Assets', loans: 'Loans (Liability)', cards: 'Credit Cards', curliab: 'Current Liabilities', capital: 'Capital Account', profinc: 'Professional Receipts', othinc: 'Other Income', profexp: 'Professional Expenses', finexp: 'Finance Costs', personal: 'Personal & Household' };
/* built-in accounts with a plain name and a formal one */
export const SYSTEM_NAMES = {
  capital: { name: 'Starting net worth', caName: 'Capital Account', old: 'Capital Account' },
  suspense: { name: 'To sort later', caName: 'Suspense', old: 'Suspense' },
  gift_out: { name: 'Gifts given to family', caName: 'Drawings – gifts to relatives' },
  gift_in: { name: 'Gifts received from family', caName: 'Capital introduced – gifts from relatives' }
};
/* investment profit accounts, created when first needed */
export const GAIN_LEDGERS = {
  gain_eq_st: { name: 'Profit on shares & equity funds – short term', caName: 'STCG – listed equity', tag: 'stcg_equity' },
  gain_eq_lt: { name: 'Profit on shares & equity funds – long term', caName: 'LTCG – listed equity', tag: 'ltcg_equity' },
  gain_oth_st: { name: 'Profit on other investments – short term', caName: 'STCG – other assets', tag: 'stcg_other' },
  gain_oth_lt: { name: 'Profit on other investments – long term', caName: 'LTCG – other assets', tag: 'ltcg_other' },
  gain_vda: { name: 'Profit on crypto', caName: 'Income from VDA', tag: 'vda_gain' },
  trade_fo: { name: 'F&O trading profit / loss', caName: 'Business income – F&O (non-speculative)', tag: 'business_fo' },
  trade_intraday: { name: 'Intraday trading profit / loss', caName: 'Speculative business income – intraday', tag: 'speculative' },
  trade_charges: { name: 'Trading charges (brokerage, STT)', caName: 'Trading expenses', tag: 'trading_expense', expense: true },
  inv_income: { name: 'Interest – PPF / NPS / other investments', caName: 'Interest on investments', tag: 'interest' }
};
export const OLD_LEDGER_NAMES = { 'Sundry Payables': 'Bills to pay' };
export const MONEY_NATURES = new Set(['bank', 'cash']);
export const PAYMENT_NATURES = new Set(['bank', 'cash', 'card']);

/* Stable tax keys. Section references live in SECTION_REFS by tax year, so a renumbering
   (Income-tax Act, 2025) never touches stored data. */
export const TAX_TAGS = {
  prof_receipts: { label: 'Professional receipts', roots: ['income'] },
  salary: { label: 'Salary', roots: ['income'] },
  interest: { label: 'Interest (other sources)', roots: ['income'] },
  dividend: { label: 'Dividend', roots: ['income'] },
  rent: { label: 'House property – rent', roots: ['income'] },
  other_income: { label: 'Other income', roots: ['income'] },
  exempt: { label: 'Exempt income', roots: ['income'] },
  capital_gain: { label: 'Capital gains (unclassified)', roots: ['income'] },
  stcg_equity: { label: 'Short-term gain – listed shares / equity funds', roots: ['income'] },
  ltcg_equity: { label: 'Long-term gain – listed shares / equity funds', roots: ['income'] },
  stcg_other: { label: 'Short-term gain – other investments (slab rate)', roots: ['income'] },
  ltcg_other: { label: 'Long-term gain – other investments', roots: ['income'] },
  vda_gain: { label: 'Crypto (virtual digital asset) gain', roots: ['income'] },
  business_fo: { label: 'F&O trading – business income', roots: ['income'] },
  speculative: { label: 'Intraday trading – speculative business', roots: ['income'] },
  trading_expense: { label: 'Trading charges (business expense)', roots: ['expense'] },
  prof_expense: { label: 'Professional expense (deductible)', roots: ['expense'] },
  depreciation: { label: 'Depreciation', roots: ['expense'] },
  personal: { label: 'Personal (not deductible)', roots: ['expense'] },
  ded_80c: { label: 'Deduction – 80C type', roots: ['expense', 'asset'] },
  ded_80d: { label: 'Deduction – 80D health insurance', roots: ['expense'] },
  ded_80g: { label: 'Deduction – 80G donation', roots: ['expense'] },
  home_loan_interest: { label: 'Home loan interest', roots: ['expense'] },
  tds_receivable: { label: 'TDS / TCS receivable', roots: ['asset'] },
  advance_tax: { label: 'Advance / self-assessment tax', roots: ['asset'] },
  none: { label: 'No tax effect', roots: ['asset', 'liability', 'capital', 'income', 'expense'] }
};
export const SECTION_REFS = {
  '2025-26': { prof_receipts: '44ADA', books: '44AA', audit: '44AB', ded_80c: '80C', ded_80d: '80D', ded_80g: '80G', rebate: '87A', tds_prof: '194J', home_loan_interest: '24(b)', stcg_equity: '111A', ltcg_equity: '112A', ltcg_other: '112', vda_gain: '115BBH', speculative: '43(5)' },
  '2026-27': { prof_receipts: '58', books: '62', audit: '63', ded_80c: '123', ded_80d: '126', rebate: '156', tds_prof: '393' }
};
export function sectionFor(tag, taxYear) {
  const y = SECTION_REFS[taxYear] || SECTION_REFS['2026-27'];
  return y[tag] || '';
}

/* [groupKey, name, opts] */
const SELF = [
  ['bank', 'SBI Savings', { alias: 'sbi' }],
  ['bank', 'Bank of Baroda', { alias: 'bob' }],
  ['bank', 'Bank of India', { alias: 'boi' }],
  ['bank', 'Kotak Savings', { alias: 'kotak' }],
  ['cash', 'Cash in Hand', { alias: 'cash' }],
  ['invest', 'Zerodha Funds (Kite)', { alias: 'kite zerodha' }],
  ['invest', 'Stocks', {}],
  ['invest', 'Mutual Funds', { alias: 'mf sip' }],
  ['invest', 'Crypto (CoinDCX)', { alias: 'coindcx crypto' }],
  ['invest', 'Gold', {}],
  ['invest', 'Fixed Deposits', { alias: 'fd' }],
  ['invest', 'PPF', { taxTag: 'ded_80c' }],
  ['invest', 'NPS', { taxTag: 'ded_80c' }],
  ['advances', 'Loan to Arihant Medicos', { alias: 'arihant' }],
  ['advances', 'Security Deposits', {}],
  ['taxassets', 'TDS Receivable', { taxTag: 'tds_receivable', system: 'tds', alias: 'tds' }],
  ['taxassets', 'Advance Tax Paid', { taxTag: 'advance_tax', alias: 'advance tax' }],
  ['fixed', 'Vehicles', {}],
  ['fixed', 'Medical Equipment', {}],
  ['fixed', 'Computers & Phones', {}],
  ['loans', 'Home Loan', {}],
  ['loans', 'Car Loan', {}],
  ['cards', 'Credit Card', { alias: 'cc card' }],
  ['curliab', 'Bills to pay', {}],
  ['curliab', 'To sort later', { system: 'suspense', note: 'Imported entries you have not sorted into a category yet. Open it and pick the right category.' }],
  ['capital', 'Starting net worth', { system: 'capital', note: 'Worked out automatically: what you owned minus what you owed on the start date.' }],
  ['profinc', 'Professional Fees – PNH', { taxTag: 'prof_receipts', site: 'PNH', tdsBps: 1000, alias: 'pnh' }],
  ['profinc', 'Professional Fees – DKM', { taxTag: 'prof_receipts', site: 'DKM', tdsBps: 1000, alias: 'dkm' }],
  ['profinc', 'Clinic Receipts', { taxTag: 'prof_receipts', site: 'Clinic', alias: 'clinic opd' }],
  ['profinc', 'OPD Camp Receipts', { taxTag: 'prof_receipts', alias: 'camp' }],
  ['othinc', 'Interest – Savings Bank', { taxTag: 'interest', alias: 'sb interest' }],
  ['othinc', 'Interest – FD', { taxTag: 'interest', alias: 'fd interest' }],
  ['othinc', 'Interest – Loans Given', { taxTag: 'interest', alias: 'arihant interest' }],
  ['othinc', 'Dividend', { taxTag: 'dividend' }],
  ['othinc', 'Rent Received', { taxTag: 'rent' }],
  ['othinc', 'PPF Interest', { taxTag: 'exempt' }],
  ['othinc', 'Other Income', { taxTag: 'other_income' }],
  ['profexp', 'Clinic Rent', { taxTag: 'prof_expense', site: 'Clinic' }],
  ['profexp', 'Staff Salary', { taxTag: 'prof_expense', alias: 'salary staff' }],
  ['profexp', 'Medical Consumables', { taxTag: 'prof_expense', alias: 'consumables' }],
  ['profexp', 'Clinic Electricity', { taxTag: 'prof_expense', site: 'Clinic' }],
  ['profexp', 'Telephone & Internet', { taxTag: 'prof_expense', alias: 'phone mobile internet' }],
  ['profexp', 'Subscriptions & CME', { taxTag: 'prof_expense', alias: 'cme journal' }],
  ['profexp', 'Conference & Professional Travel', { taxTag: 'prof_expense', alias: 'conference' }],
  ['profexp', 'Vehicle Running (Professional)', { taxTag: 'prof_expense', alias: 'fuel petrol diesel' }],
  ['profexp', 'Professional Indemnity Insurance', { taxTag: 'prof_expense', alias: 'indemnity' }],
  ['profexp', 'Accounting & Legal Fees', { taxTag: 'prof_expense', alias: 'ca' }],
  ['profexp', 'Depreciation', { taxTag: 'depreciation' }],
  ['finexp', 'Home Loan Interest', { taxTag: 'home_loan_interest' }],
  ['finexp', 'Car Loan Interest', { taxTag: 'prof_expense' }],
  ['finexp', 'Bank & Card Charges', { taxTag: 'prof_expense', alias: 'charges' }],
  ['personal', 'Household', { taxTag: 'personal', alias: 'home' }],
  ['personal', 'Groceries', { taxTag: 'personal', alias: 'grocery vegetables' }],
  ['personal', 'Fuel (Personal)', { taxTag: 'personal' }],
  ['personal', 'Dining & Entertainment', { taxTag: 'personal', alias: 'food restaurant swiggy zomato' }],
  ['personal', 'Travel & Holidays', { taxTag: 'personal', alias: 'travel holiday' }],
  ['personal', 'Shopping & Clothing', { taxTag: 'personal', alias: 'shopping amazon flipkart' }],
  ['personal', 'Children & Education', { taxTag: 'personal', alias: 'school fees education' }],
  ['personal', 'Family Medical', { taxTag: 'personal', alias: 'medicine' }],
  ['personal', 'Utilities (Home)', { taxTag: 'personal', alias: 'electricity gas water' }],
  ['personal', 'Life Insurance Premium', { taxTag: 'ded_80c', alias: 'lic' }],
  ['personal', 'Health Insurance Premium', { taxTag: 'ded_80d', alias: 'mediclaim' }],
  ['personal', 'Donations', { taxTag: 'ded_80g' }],
  ['personal', 'Income Tax (Prior Years)', { taxTag: 'none' }],
  ['personal', 'Miscellaneous', { taxTag: 'personal', alias: 'misc' }]
];
const SPOUSE = [
  ['bank', 'HDFC Savings', { alias: 'hdfc' }],
  ['bank', 'IDFC FIRST Savings', { alias: 'idfc' }],
  ['bank', 'ICICI Savings', { alias: 'icici' }],
  ['cash', 'Cash in Hand', { alias: 'cash' }],
  ['invest', 'Zerodha Funds (Kite)', { alias: 'kite zerodha' }],
  ['invest', 'Stocks', {}],
  ['invest', 'Mutual Funds', { alias: 'mf sip' }],
  ['invest', 'Gold', {}],
  ['invest', 'Fixed Deposits', { alias: 'fd' }],
  ['invest', 'PPF', { taxTag: 'ded_80c' }],
  ['taxassets', 'TDS Receivable', { taxTag: 'tds_receivable', system: 'tds', alias: 'tds' }],
  ['taxassets', 'Advance Tax Paid', { taxTag: 'advance_tax' }],
  ['cards', 'Credit Card', { alias: 'cc card' }],
  ['curliab', 'To sort later', { system: 'suspense' }],
  ['capital', 'Starting net worth', { system: 'capital', note: 'Worked out automatically: what you owned minus what you owed on the start date.' }],
  ['profinc', 'Professional Receipts', { taxTag: 'prof_receipts' }],
  ['othinc', 'Salary', { taxTag: 'salary' }],
  ['othinc', 'Interest – Savings Bank', { taxTag: 'interest', alias: 'sb interest' }],
  ['othinc', 'Interest – FD', { taxTag: 'interest', alias: 'fd interest' }],
  ['othinc', 'Dividend', { taxTag: 'dividend' }],
  ['othinc', 'Other Income', { taxTag: 'other_income' }],
  ['profexp', 'Professional Expenses', { taxTag: 'prof_expense' }],
  ['finexp', 'Bank & Card Charges', { taxTag: 'personal', alias: 'charges' }],
  ['personal', 'Household', { taxTag: 'personal' }],
  ['personal', 'Shopping & Clothing', { taxTag: 'personal', alias: 'shopping' }],
  ['personal', 'Travel & Holidays', { taxTag: 'personal' }],
  ['personal', 'Life Insurance Premium', { taxTag: 'ded_80c', alias: 'lic' }],
  ['personal', 'Health Insurance Premium', { taxTag: 'ded_80d', alias: 'mediclaim' }],
  ['personal', 'Miscellaneous', { taxTag: 'personal', alias: 'misc' }]
];
export const TEMPLATES = { self: SELF, spouse: SPOUSE };
export const DEFAULT_SITES = { self: ['PNH', 'DKM', 'Clinic'], spouse: [] };

export function makeEntity({ name, kind = 'person', accent = '#d9b35a', template = 'self', order = 0 }) {
  return {
    id: uid('ent'), name, kind, accent, template, order,
    lockedUpto: '', sites: (DEFAULT_SITES[template] || []).map(n => ({ id: uid('site'), name: n })),
    createdAt: nowISO(), updatedAt: nowISO()
  };
}

/* Build groups + ledgers for an entity from a template. Returns { groups, ledgers }. */
export function seedMasters(entity, template = entity.template || 'self') {
  const groups = GROUP_TEMPLATE.map((g, i) => ({
    id: uid('grp'), entityId: entity.id, key: g.key, name: g.name, root: g.root, nature: g.nature,
    parentId: null, order: i, system: true, createdAt: nowISO(), updatedAt: nowISO()
  }));
  const byKey = Object.fromEntries(groups.map(g => [g.key, g]));
  const siteId = n => (entity.sites.find(s => s.name === n) || {}).id || '';
  const ledgers = (TEMPLATES[template] || SELF).map(([gk, name, o], i) => makeLedger({
    entityId: entity.id, groupId: byKey[gk].id, name, alias: o.alias || '', taxTag: o.taxTag || defaultTag(byKey[gk]),
    siteId: o.site ? siteId(o.site) : '', tdsBps: o.tdsBps || 0, system: o.system || '', note: o.note || '', order: i
  }));
  return { groups, ledgers };
}
export function defaultTag(group) {
  if (!group) return 'none';
  if (group.nature === 'profincome') return 'prof_receipts';
  if (group.nature === 'profexpense') return 'prof_expense';
  if (group.nature === 'personal') return 'personal';
  if (group.root === 'income') return 'other_income';
  if (group.root === 'expense') return 'personal';
  return 'none';
}
export function makeLedger(p) {
  return {
    id: uid('led'), entityId: p.entityId, groupId: p.groupId, name: p.name, alias: p.alias || '',
    opening: p.opening || 0, taxTag: p.taxTag || 'none', siteId: p.siteId || '', tdsBps: p.tdsBps || 0,
    system: p.system || '', interEntityWith: p.interEntityWith || '', archived: false, note: p.note || '',
    order: p.order || 0, createdAt: nowISO(), updatedAt: nowISO()
  };
}
export function makeGroup(p) {
  return {
    id: uid('grp'), entityId: p.entityId, key: p.key || '', name: p.name, root: p.root, nature: p.nature || 'other',
    parentId: p.parentId || null, order: p.order || 99, system: false, createdAt: nowISO(), updatedAt: nowISO()
  };
}

/* Copy masters (groups + ledgers, no balances) from one entity to another, skipping names that already exist. */
export function copyMasters(src, dstEntity, dstGroups, dstLedgers) {
  const outG = [], outL = [];
  const gMap = new Map();
  for (const g of src.groups) {
    let d = dstGroups.find(x => (g.key && x.key === g.key) || x.name.toLowerCase() === g.name.toLowerCase());
    if (!d) { d = makeGroup({ ...g, entityId: dstEntity.id }); d.key = g.key; outG.push(d); }
    gMap.set(g.id, d.id);
  }
  for (const l of src.ledgers) {
    if (l.system === 'capital' || l.interEntityWith) continue;
    if (dstLedgers.some(x => x.name.toLowerCase() === l.name.toLowerCase())) continue;
    const site = l.siteId ? (src.sites || []).find(s => s.id === l.siteId) : null;
    const dsite = site ? (dstEntity.sites || []).find(s => s.name === site.name) : null;
    outL.push(makeLedger({ ...l, entityId: dstEntity.id, groupId: gMap.get(l.groupId), opening: 0, siteId: dsite ? dsite.id : '' }));
  }
  return { groups: outG, ledgers: outL };
}
