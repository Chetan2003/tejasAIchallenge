/**
 * Things that can happen to a customer's books, named the way the business
 * says them. A handler reports what happened; the reaction table in
 * `action-catalog.ts` says what must follow. Handlers never call the
 * follow-up work themselves.
 */
export const DOMAIN_EVENTS = {
  PAYMENT_RECEIVED: 'a payment is recorded for the customer',
  CASH_ALLOCATION_REQUESTED: 'Accounts asks to allocate free cash',
  DELIVERY_CONFIRMED: 'delivery of goods is confirmed',
  GOODS_CORRECTED: 'additional dispatched goods are recorded',
  RETURN_SETTLED: 'a physical return is settled',
  DEMAND_CANCELED: 'unshipped demand is canceled',
  DELIVERY_CORRECTED: 'a delivery confirmation is lowered',
  PAYMENT_RELEASED: 'a payment recorded for the customer is moved away',
} as const;

export type DomainEvent = keyof typeof DOMAIN_EVENTS;
