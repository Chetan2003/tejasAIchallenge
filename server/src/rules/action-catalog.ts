import type { Role } from '@crm/shared';
import type { CommandType } from '@crm/shared/crm';
import type { DomainEvent } from './domain-events.js';

/**
 * Business rules about actions, as data. One entry per command.
 *
 * - `roles`   who may run it (Admin may run everything).
 * - `summary` one plain sentence, shown in the generated rule sheet.
 * - `rules`   the canonical rule ids it implements.
 * - `emits`   the events it may report. The engine rejects any other event,
 *             so this list cannot drift from what the handler really does.
 *
 * Detailed conditions stay in the domain models next to the quantities they
 * guard. This file answers: who, what for, and what happens afterwards.
 */
export interface ActionRule {
  readonly roles: readonly Role[];
  readonly summary: string;
  readonly rules: readonly string[];
  readonly emits: readonly DomainEvent[];
}

const action = (
  roles: Role[],
  summary: string,
  rules: string[],
  emits: DomainEvent[] = [],
): ActionRule => ({ roles, summary, rules, emits });

export const ACTIONS: Record<CommandType, ActionRule> = {
  UPDATE_CUSTOMER: action(
    ['SALES', 'ACCOUNTS'],
    'Change customer name/code.',
    [],
  ),
  PUNCH_ORDER: action(['SALES'], 'Create a draft commercial revision.', [
    'CAT-002',
    'ORD-005',
  ]),
  EDIT_ORDER: action(
    ['SALES'],
    'Replace the current commercial terms with a new revision.',
    ['ORD-003', 'ORD-005', 'ORD-006'],
  ),
  SUBMIT_ORDER: action(['SALES'], 'Submit a revision for commercial review.', [
    'ORD-005',
  ]),
  APPROVE_ORDER: action(['KAM'], 'Approve the exact current revision.', [
    'ORD-005',
    'REW-001',
  ]),
  REJECT_ORDER: action(
    ['KAM'],
    'Reject the exact current revision with a reason.',
    ['ORD-005'],
  ),
  CANCEL_REMAINDER: action(
    ['SALES'],
    'Cancel selected or all eligible unshipped demand.',
    ['ORD-004', 'ORD-006', 'REW-001'],
    ['DEMAND_CANCELED'],
  ),
  START_LOADING: action(['WAREHOUSE'], 'Reserve units in a loading batch.', [
    'FUL-003',
    'FUL-004',
  ]),
  DISPATCH_SHIPMENT: action(
    ['WAREHOUSE'],
    'Confirm that the loaded batch left the warehouse.',
    ['FUL-003', 'FUL-005'],
  ),
  CONFIRM_DELIVERY: action(
    ['WAREHOUSE'],
    'Confirm some or all remaining dispatched units.',
    ['FUL-006', 'WF-005'],
    ['DELIVERY_CONFIRMED'],
  ),
  RECORD_RETURN: action(
    ['WAREHOUSE'],
    'Receive delivered units back; record an explicit deduction.',
    ['RET-001', 'RET-002', 'WF-003'],
    ['RETURN_SETTLED'],
  ),
  CORRECT_DISPATCHED_ORDER: action(
    ['KAM'],
    'Record authorized additional dispatched goods.',
    ['WF-004', 'WF-005'],
    ['GOODS_CORRECTED'],
  ),
  CORRECT_DELIVERY: action(
    ['KAM'],
    'Lower an overstated delivery confirmation to what really arrived.',
    ['FUL-001', 'FUL-006', 'WF-001', 'WF-003', 'WF-006'],
    ['DELIVERY_CORRECTED'],
  ),
  RECEIVE_CUSTOMER_PAYMENT: action(
    ['ACCOUNTS'],
    'Capture customer cash and allocate eligible value.',
    ['ACC-002', 'ACC-003'],
    ['PAYMENT_RECEIVED'],
  ),
  ALLOCATE_PAYMENT: action(
    ['ACCOUNTS'],
    'Allocate existing free cash.',
    ['ACC-003'],
    ['CASH_ALLOCATION_REQUESTED'],
  ),
  MOVE_CUSTOMER_PAYMENT: action(
    ['ACCOUNTS'],
    'Move a payment recorded against the wrong customer to the right one.',
    ['CUS-001', 'ACC-002', 'ACC-004', 'WF-001'],
    ['PAYMENT_RELEASED', 'PAYMENT_RECEIVED'],
  ),
  ISSUE_CREDIT_NOTE: action(
    ['ACCOUNTS'],
    'Reserve free receipt value as explicit credit.',
    ['CRD-001', 'CRD-002'],
  ),
  APPLY_CREDIT_NOTE: action(
    ['ACCOUNTS'],
    'Settle a selected charge with credit.',
    ['CRD-003'],
  ),
  REFUND_CREDIT_NOTE: action(
    ['ACCOUNTS'],
    'Record a payout from available credit.',
    ['CRD-004'],
  ),
  REVERSE_CREDIT_APPLICATION: action(
    ['ACCOUNTS'],
    'Undo an eligible amount of a recorded application.',
    ['CRD-005', 'CRD-006'],
  ),
  REVERSE_CREDIT_REFUND: action(
    ['ACCOUNTS'],
    'Undo an eligible amount of a recorded payout.',
    ['CRD-005', 'CRD-006'],
  ),
  REDEEM_POINTS: action(
    ['SALES', 'ACCOUNTS'],
    'Settle a charge with available points.',
    ['REW-004'],
  ),
};

/**
 * What follows an event, for the customer the event names. Allocation
 * occasions are exactly those of WF-002: "Other operations do not trigger
 * cash allocation." Reward points are re-derived from cash and retained units
 * (REW-001..003) after anything that moves either.
 */
const ALLOCATION_OCCASIONS = [
  'PAYMENT_RECEIVED',
  'CASH_ALLOCATION_REQUESTED',
  'DELIVERY_CONFIRMED',
  'GOODS_CORRECTED',
  'RETURN_SETTLED',
] as const satisfies readonly DomainEvent[];

export const REACTIONS = {
  allocateCash: {
    rule: 'WF-002',
    does: 'allocates the customer’s free cash to their oldest charges',
    after: ALLOCATION_OCCASIONS,
  },
  refreshRewards: {
    rule: 'REW-001..003',
    does: 'recomputes the customer’s points from cash and retained units',
    after: [
      ...ALLOCATION_OCCASIONS,
      'DEMAND_CANCELED',
      'DELIVERY_CORRECTED',
      'PAYMENT_RELEASED',
    ],
  },
} as const satisfies Record<
  string,
  { rule: string; does: string; after: readonly DomainEvent[] }
>;

export type ReactionName = keyof typeof REACTIONS;
/** Reactions run in this order for each customer. Cash first: points follow cash. */
export const REACTION_ORDER: readonly ReactionName[] = [
  'allocateCash',
  'refreshRewards',
];
