import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEntity, seedMasters } from '../js/core/masters.js';
import { makeCtx, balances, trialBalance } from '../js/core/books.js';
import { buildLegacyPlan, suggestMapping, legacyBalances, normalizeLegacy, looksLegacy } from '../js/core/legacy.js';
import { validateVoucher } from '../js/core/vouchers.js';

function oldState() {
  return {
    schemaVersion: 11, meta: { moneyUnit: 'paise' }, settings: { walletRules: { me: ['sbi'], spouse: ['hdfc'] } },
    hospitals: [{ id: 'h1', name: 'Apollo' }],
    accounts: [
      { id: 'a1', name: 'SBI Savings', type: 'bank', opening: 5000000, owner: 'me' },
      { id: 'a2', name: 'HDFC Savings', type: 'bank', opening: 1000000, owner: 'spouse' },
      { id: 'a3', name: 'Cash in Hand', type: 'cash', opening: 200000, owner: 'me' },
      { id: 'a4', name: 'Amex', type: 'card', opening: -300000, owner: 'me' }
    ],
    incomeCats: [{ id: 'c1', name: 'Hospital 1', group: 'hospital' }, { id: 'c2', name: 'Interest', group: 'interest' }],
    expenseCats: [{ id: 'e1', name: 'Household', group: 'personal' }, { id: 'e2', name: 'Staff Salary', group: 'professional' }, { id: 'cat_loan_l1', name: 'EMI – Home', group: 'loan', loanId: 'l1' }],
    income: [
      { id: 'i1', amount: 900000, date: '2026-04-07', catId: 'c1', accountId: 'a1', owner: 'me', tdsRate: 10, cash: false },
      { id: 'i2', amount: 50000, date: '2026-04-08', catId: 'c1', accountId: 'a3', owner: 'me', cash: true },
      { id: 'i3', amount: 20000, date: '2026-04-09', catId: 'c2', accountId: 'a1', owner: 'spouse' }
    ],
    expenses: [
      { id: 'x1', amount: 150000, date: '2026-04-10', catId: 'e1', accountId: 'a4' },
      { id: 'x2', amount: 38000, date: '2026-04-11', catId: 'cat_loan_l1', accountId: 'a1', loanId: 'l1', interest: 23000 },
      { id: 'x3', amount: 10000, date: '2026-04-12', catId: 'e2', accountId: 'a2' }
    ],
    transfers: [{ id: 't1', amount: 100000, date: '2026-04-13', fromId: 'a1', toId: 'a2' }, { id: 't2', amount: 30000, date: '2026-04-14', fromId: 'a1', toId: 'a3' }],
    investments: [{ id: 'v1', name: 'Parag Parikh', type: 'Mutual Funds', invested: 500000, value: 560000, fundFrom: 'a1', created: '2026-04-15T00:00:00Z' },
                  { id: 'v2', name: 'INFY', type: 'Stocks', qty: 10, avg: 150000, price: 160000 }],
    loans: [{ id: 'l1', name: 'Home loan - SBI', type: 'home', outstanding: 300000000, linkedAccountId: 'a1', rate: 8.5 }],
    loanLedger: [{ id: 'p1', loanId: 'l1', accountId: 'a1', amount: 1000000, interest: 0, date: '2026-04-20', kind: 'draw' }],
    opd: [], rules: [{ id: 'r1', pattern: 'swiggy', catId: 'e1', kind: 'expense' }],
    taxPnl: [{ owner: 'me', fy: '2025-26', stcg: 1000, ltcg: 2000 }]
  };
}
function targets() {
  const out = {};
  for (const [o, tpl] of [['me', 'self'], ['spouse', 'spouse']]) {
    const entity = makeEntity({ name: o === 'me' ? 'You' : 'Spouse', template: tpl });
    const { groups, ledgers } = seedMasters(entity, tpl);
    out[o] = { entity, groups, ledgers };
  }
  return out;
}

test('legacy detection and rupee->paise normalisation', () => {
  assert.ok(looksLegacy(oldState()));
  const v10 = { schemaVersion: 10, accounts: [{ id: 'a', name: 'x', type: 'bank', opening: 12.5 }], income: [{ amount: 99.99 }] };
  const n = normalizeLegacy(v10);
  assert.equal(n.accounts[0].opening, 1250); assert.equal(n.income[0].amount, 9999);
  assert.equal(v10.accounts[0].opening, 12.5, 'input untouched');
});

test('migration reproduces every old account balance and balances the books', () => {
  const s = oldState(), T = targets();
  const map = suggestMapping(s, T);
  assert.equal(map['acc:a1'], T.me.ledgers.find(l => l.name === 'SBI Savings').id);
  assert.equal(map['acc:a2'], T.spouse.ledgers.find(l => l.name === 'HDFC Savings').id);
  const plan = buildLegacyPlan(s, T, map);
  for (const c of plan.checks) assert.equal(c.actual, c.expected, c.name);
  const old = legacyBalances(s);
  for (const o of ['me', 'spouse']) {
    const t = T[o];
    const ledgers = t.ledgers.concat(plan.newLedgers.filter(l => l.entityId === t.entity.id)).map(l => ({ ...l, opening: (l.opening || 0) + (plan.openingDeltas.get(l.id) || 0) }));
    const vouchers = plan.vouchers.filter(v => v.entityId === t.entity.id);
    const ctx = makeCtx({ entity: t.entity, groups: t.groups, ledgers, vouchers });
    for (const v of vouchers) assert.deepEqual(validateVoucher(ctx, v), [], JSON.stringify(v.lines));
    assert.equal(trialBalance(ctx).diff, 0);
    const b = balances(ctx);
    if (o === 'me') {
      assert.equal(b.get(map['acc:a1']).closing, old.get('a1'));
      const tds = ledgers.find(l => l.taxTag === 'tds_receivable');
      assert.equal(b.get(tds.id).closing, 100000);
      const loan = ledgers.find(l => l.name === 'Home loan - SBI');
      assert.equal(b.get(loan.id).closing, -(300000000 + 1000000 - 15000));
      const inter = ledgers.find(l => l.interEntityWith === T.spouse.entity.id);
      assert.equal(b.get(inter.id).closing, 100000 - 20000);
    } else {
      assert.equal(b.get(map['acc:a2']).closing, old.get('a2'));
      const inter = ledgers.find(l => l.interEntityWith === T.me.entity.id);
      assert.equal(b.get(inter.id).closing, -(100000 - 20000));
    }
  }
  assert.equal(plan.holdings.length, 2);
  assert.equal(plan.rules[0].ledgerId, T.me.ledgers.find(l => l.name === 'Household').id);
  assert.deepEqual(plan.sites, ['Apollo']);
  const cashRcpt = plan.vouchers.find(v => v.legacyId === 'i2');
  assert.equal(cashRcpt.meta.mode, 'cash');
});
