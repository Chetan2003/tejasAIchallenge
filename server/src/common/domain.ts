import type {
  ActionResult,
  CrmCommand,
  OrderListRow,
  Customer,
} from '@crm/shared/crm';
import type { User, Role } from '@crm/shared';
import type { DomainEvent } from '../rules/domain-events.js';
export type Payload<T extends CrmCommand['type']> = Extract<
  CrmCommand,
  { type: T }
>['payload'];
export interface ActionContext {
  id: string;
  actor: User;
  requester: User;
  now: string;
  /** The customer the command is filed under (its version is the one checked). */
  customerId: string;
  /** Every customer whose books the command changes, including `customerId`. */
  customerIds: Set<string>;
  /** What happened to whom. The engine turns these into follow-up work (see the reaction table). */
  events: Array<{ type: DomainEvent; customerId: string }>;
  /** Events the running action declared in the action catalog; anything else is a bug. */
  allowedEvents?: readonly DomainEvent[];
  orderId?: string;
  effects: ActionResult['effects'];
  references: Record<string, string>;
  command?: CrmCommand;
}
export class DomainFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export class DomainDecision extends Error {
  constructor(readonly decisions: ActionResult['decisions']) {
    super('Additional shipment information is required');
  }
}
export function fail(code: string, message: string): never {
  throw new DomainFailure(code, message);
}
export function safe(value: number) {
  if (!Number.isSafeInteger(value))
    fail('AMOUNT_RANGE', 'The amount exceeds the supported range');
  return value;
}
export function distinct(ids: string[]) {
  if (new Set(ids).size !== ids.length)
    fail('DUPLICATE_ITEM', 'Submit each line only once');
}
export function authorize(c: ActionContext, ...roles: Role[]) {
  if (!roles.includes(c.actor.role))
    fail('FORBIDDEN', 'This operation requires a different role');
}
/** Declare that the command changes this customer's books (versions, audit trail, invariant review). */
export function touch(c: ActionContext, customerId: string) {
  c.customerIds.add(customerId);
}
/**
 * Report that something happened to a customer's books. This also marks the
 * customer as affected. What must follow is decided by the reaction table,
 * not by the caller.
 */
export function emit(
  c: ActionContext,
  type: DomainEvent,
  customerId = c.customerId,
) {
  if (c.allowedEvents && !c.allowedEvents.includes(type))
    throw new Error(
      `${type} is not declared for this action in the action catalog`,
    );
  c.events.push({ type, customerId });
  touch(c, customerId);
}
export function useOrder(c: ActionContext, order: OrderListRow | undefined) {
  if (!order) fail('NOT_FOUND', 'Order not found');
  c.customerId = order.customer_id;
  touch(c, order.customer_id);
  c.orderId = order.id;
  return order;
}
export function useCustomer(c: ActionContext, customer: Customer | undefined) {
  if (!customer) fail('NOT_FOUND', 'Customer not found');
  c.customerId = customer.id;
  touch(c, customer.id);
  return customer;
}
export function recordInsert(
  c: ActionContext,
  entity: string,
  row: unknown,
  append = false,
) {
  c.effects.push({
    entity,
    operation: append ? 'APPEND' : 'INSERT',
    after: row,
  });
}
export function recordUpdate(
  c: ActionContext,
  entity: string,
  before: unknown,
  after: unknown,
) {
  c.effects.push({ entity, operation: 'UPDATE', before, after });
}
