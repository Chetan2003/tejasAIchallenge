import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { crmActionSchema } from '@crm/shared/crm';
import { ACTIONS, REACTIONS } from '../src/rules/action-catalog.js';
import { DOMAIN_EVENTS } from '../src/rules/domain-events.js';
import { renderRuleSheet, roleName } from '../src/rules/render-catalog.js';
import { emit } from '../src/common/domain.js';
import type { ActionContext } from '../src/common/domain.js';

const commandTypes = crmActionSchema.options.map(
  (option) => option.shape.type.value,
);

describe('action catalog', () => {
  it('has exactly one entry for every command the API accepts', () => {
    assert.deepEqual(
      [...Object.keys(ACTIONS)].sort(),
      [...commandTypes].sort(),
    );
  });

  it('is the source of the checked-in rule sheet (run `pnpm rules:doc` after editing the catalog)', () => {
    assert.equal(
      readFileSync(resolve('../docs/rules-catalog.md'), 'utf8'),
      renderRuleSheet(),
    );
  });

  it('agrees with the role column of the business-terms action table', () => {
    const table = readFileSync(
      resolve('../docs/candidate-walkthrough/business_terms.md'),
      'utf8',
    );
    const documented = new Map(
      [...table.matchAll(/^\| `([A-Z_]+)`\s*\|\s*([^|]+?)\s*\|/gm)].map(
        (match) => [match[1]!, match[2]!],
      ),
    );
    assert.deepEqual(
      [...documented.keys()].sort(),
      [...commandTypes].sort(),
      'every action is documented, and nothing else is',
    );
    for (const [type, rule] of Object.entries(ACTIONS))
      assert.equal(
        documented.get(type),
        rule.roles.map(roleName).join(', '),
        `${type} roles`,
      );
  });

  it('only lists events that exist, and every event is emitted by some action', () => {
    const emitted = new Set(Object.values(ACTIONS).flatMap((a) => a.emits));
    for (const event of Object.keys(DOMAIN_EVENTS))
      assert.ok(emitted.has(event as never), `${event} is never emitted`);
    for (const reaction of Object.values(REACTIONS))
      for (const event of reaction.after)
        assert.ok(event in DOMAIN_EVENTS, `${event} is unknown`);
  });

  it('allocates cash only after the occasions WF-002 lists', () => {
    assert.deepEqual([...REACTIONS.allocateCash.after].sort(), [
      'CASH_ALLOCATION_REQUESTED',
      'DELIVERY_CONFIRMED',
      'GOODS_CORRECTED',
      'PAYMENT_RECEIVED',
      'RETURN_SETTLED',
    ]);
  });

  it('rejects an event the running action did not declare', () => {
    const context = {
      customerId: 'c',
      customerIds: new Set(['c']),
      events: [],
      allowedEvents: ACTIONS.CORRECT_DELIVERY.emits,
    } as unknown as ActionContext;
    emit(context, 'DELIVERY_CORRECTED');
    assert.throws(
      () => emit(context, 'PAYMENT_RECEIVED'),
      /not declared for this action/,
    );
    assert.deepEqual(context.events, [
      { type: 'DELIVERY_CORRECTED', customerId: 'c' },
    ]);
  });

  it('marks every customer named by an event as affected', () => {
    const context = {
      customerId: 'from',
      customerIds: new Set(['from']),
      events: [],
      allowedEvents: ACTIONS.MOVE_CUSTOMER_PAYMENT.emits,
    } as unknown as ActionContext;
    emit(context, 'PAYMENT_RELEASED');
    emit(context, 'PAYMENT_RECEIVED', 'to');
    assert.deepEqual([...context.customerIds], ['from', 'to']);
  });
});
