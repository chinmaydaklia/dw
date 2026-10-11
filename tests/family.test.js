import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEntity, seedMasters, GROUP_TEMPLATE, OLD_GROUP_NAMES, SYSTEM_NAMES } from '../js/core/masters.js';
import { makeCtx, balances, trialBalance, profitLoss, family } from '../js/core/books.js';

test('plain names exist for every built-in section, with formal names kept for the CA', () => {
  for (const g of GROUP_TEMPLATE) { assert.ok(g.name && g.caName, g.key); if (g.key !== 'invest') assert.ok(OLD_GROUP_NAMES[g.key], g.key); }
  const e = makeEntity({ name: 'You' });
  const { ledgers } = seedMasters(e);
  const names = ledgers.map(l => l.name);
  assert.ok(names.includes('To sort later') && names.includes('Starting net worth') && names.includes('Bills to pay'));
  assert.ok(!names.some(n => /sundry|suspense|capital account/i.test(n)));
  assert.equal(SYSTEM_NAMES.suspense.caName, 'Suspense');
});

/* The store does this with saveFamilyTransfer; here the same double-sided entries are checked in the engine. */
test('gift between spouses: no income or spending, both books balance, family net worth unchanged', () => {
  const you = makeEntity({ name: 'You' }), sp = makeEntity({ name: 'Spouse', template: 'spouse' });
  const A = seedMasters(you), B = seedMasters(sp, 'spouse');
  const cap = (m, ent) => m.groups.find(g => g.key === 'capital');
  const giftOut = { id: 'g_out', entityId: you.id, groupId: cap(A).id, name: 'Gifts given to family', system: 'gift_out', opening: 0, taxTag: 'none' };
  const giftIn = { id: 'g_in', entityId: sp.id, groupId: cap(B).id, name: 'Gifts received from family', system: 'gift_in', opening: 0, taxTag: 'none' };
  const cashA = A.ledgers.find(l => l.name === 'Cash in Hand'); cashA.opening = 50000_00;
  const bankB = B.ledgers.find(l => l.name === 'HDFC Savings');
  const vA = [{ id: 'a', entityId: you.id, date: '2026-10-01', lines: [{ ledgerId: 'g_out', dr: 20000_00, cr: 0 }, { ledgerId: cashA.id, dr: 0, cr: 20000_00 }] }];
  const vB = [{ id: 'b', entityId: sp.id, date: '2026-10-01', lines: [{ ledgerId: bankB.id, dr: 20000_00, cr: 0 }, { ledgerId: 'g_in', dr: 0, cr: 20000_00 }] }];
  const cA = makeCtx({ entity: you, groups: A.groups, ledgers: [...A.ledgers, giftOut], vouchers: vA });
  const cB = makeCtx({ entity: sp, groups: B.groups, ledgers: [...B.ledgers, giftIn], vouchers: vB });
  assert.equal(trialBalance(cA).diff, 0); assert.equal(trialBalance(cB).diff, 0);
  assert.equal(profitLoss(cA, {}).totalExpense, 0); assert.equal(profitLoss(cB, {}).totalIncome, 0);
  assert.equal(balances(cA).get(cashA.id).closing, 30000_00);
  assert.equal(balances(cB).get(bankB.id).closing, 20000_00);
  const f = family([cA, cB], { asOf: '2026-10-31', from: '2026-04-01' });
  assert.equal(f.total.netWorth, 50000_00);
});
