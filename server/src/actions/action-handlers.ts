import type { CommandType } from '@crm/shared/crm';
import type { ActionContext as Context, Payload } from '../common/domain.js';
import type { CustomersService } from '../customers/customers.service.js';
import type { OrdersService } from '../orders/orders.service.js';
import type { FulfillmentService } from '../fulfillment/fulfillment.service.js';
import type { ReturnsService } from '../returns/returns.service.js';
import type { AccountsService } from '../accounts/accounts.service.js';
import type { RewardsService } from '../rewards/rewards.service.js';
import type { CreditsService } from '../credits/credits.service.js';

export interface DomainServices {
  customers: CustomersService;
  orders: OrdersService;
  fulfillment: FulfillmentService;
  returns: ReturnsService;
  accounts: AccountsService;
  rewards: RewardsService;
  credits: CreditsService;
}

/** One handler per command, typed by its payload. A missing entry does not compile. */
export type Handlers = {
  [T in CommandType]: (c: Context, payload: Payload<T>) => void;
};

/**
 * Which domain method performs each command. Pure wiring: who may run it
 * and what follows live in the action catalog, not here.
 */
export const handlersFor = (s: DomainServices): Handlers => ({
  UPDATE_CUSTOMER: (c, p) => s.customers.updateCustomer(c, p),
  PUNCH_ORDER: (c, p) => s.orders.punch(c, p),
  EDIT_ORDER: (c, p) => s.orders.edit(c, p),
  SUBMIT_ORDER: (c, p) => s.orders.submit(c, p),
  APPROVE_ORDER: (c, p) => s.orders.approve(c, p),
  REJECT_ORDER: (c, p) => s.orders.reject(c, p),
  CANCEL_REMAINDER: (c, p) => s.orders.cancel(c, p),
  START_LOADING: (c, p) => s.fulfillment.load(c, p),
  DISPATCH_SHIPMENT: (c, p) => s.fulfillment.dispatch(c, p),
  CONFIRM_DELIVERY: (c, p) => s.fulfillment.deliver(c, p),
  RECORD_RETURN: (c, p) => s.returns.returnItems(c, p),
  CORRECT_DISPATCHED_ORDER: (c, p) => s.fulfillment.correct(c, p),
  CORRECT_DELIVERY: (c, p) => s.fulfillment.correctDelivery(c, p),
  RECEIVE_CUSTOMER_PAYMENT: (c, p) => s.accounts.receive(c, p),
  ALLOCATE_PAYMENT: (c, p) => s.accounts.allocate(c, p),
  MOVE_CUSTOMER_PAYMENT: (c, p) => s.accounts.moveReceipt(c, p),
  ISSUE_CREDIT_NOTE: (c, p) => s.credits.issueCredit(c, p),
  APPLY_CREDIT_NOTE: (c, p) => s.credits.applyCredit(c, p),
  REFUND_CREDIT_NOTE: (c, p) => s.credits.refundCredit(c, p),
  REVERSE_CREDIT_APPLICATION: (c, p) =>
    s.credits.reverseCreditApplication(c, p),
  REVERSE_CREDIT_REFUND: (c, p) => s.credits.reverseCreditRefund(c, p),
  REDEEM_POINTS: (c, p) => s.rewards.redeem(c, p),
});
