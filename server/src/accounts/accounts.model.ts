import { safe } from '../common/domain.js';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { crmCustomers } from '../customers/customers.model.js';
import { crmOrders } from '../orders/orders.model.js';

export const crmReceivableEntries = sqliteTable(
  'receivable_entries',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    line_key: text('line_key'),
    shipment_line_id: text('shipment_line_id'),
    kind: text('kind').notNull(),
    amount_paise: integer('amount_paise').notNull(),
    adjusts_id: text('adjusts_id'),
    source_id: text('source_id').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('receivable_entries_customer_id_idx').on(t.customer_id),
    index('receivable_entries_order_id_idx').on(t.order_id),
    check(
      'receivable_entries_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer'`,
    ),
  ],
);

export const crmPaymentReceipts = sqliteTable(
  'payment_receipts',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    amount_paise: integer('amount_paise').notNull(),
    reference: text('reference').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('payment_receipts_customer_id_idx').on(t.customer_id),
    check(
      'payment_receipts_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer' and ${t.amount_paise} > 0`,
    ),
  ],
);

export const crmPaymentAllocations = sqliteTable(
  'payment_allocations',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    receipt_id: text('receipt_id')
      .notNull()
      .references(() => crmPaymentReceipts.id, { onDelete: 'cascade' }),
    charge_id: text('charge_id')
      .notNull()
      .references(() => crmReceivableEntries.id, { onDelete: 'cascade' }),
    amount_paise: integer('amount_paise').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('payment_allocations_customer_id_idx').on(t.customer_id),
    index('payment_allocations_receipt_id_idx').on(t.receipt_id),
    index('payment_allocations_charge_id_idx').on(t.charge_id),
    check(
      'payment_allocations_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer'`,
    ),
  ],
);

/**
 * ACC-004. Value of a receipt that was recorded against the wrong customer and
 * moved to the right one. The source receipt is never edited: this document
 * consumes its value (like credit funding does) and names the new receipt that
 * now carries the money on the destination customer.
 */
export const crmReceiptMoves = sqliteTable(
  'receipt_moves',
  {
    id: text('id').primaryKey(),
    receipt_id: text('receipt_id')
      .notNull()
      .references(() => crmPaymentReceipts.id, { onDelete: 'cascade' }),
    to_receipt_id: text('to_receipt_id')
      .notNull()
      .references(() => crmPaymentReceipts.id, { onDelete: 'cascade' }),
    from_customer_id: text('from_customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    to_customer_id: text('to_customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    amount_paise: integer('amount_paise').notNull(),
    reason: text('reason').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('receipt_moves_receipt_id_idx').on(t.receipt_id),
    index('receipt_moves_from_customer_id_idx').on(t.from_customer_id),
    check(
      'receipt_moves_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer' and ${t.amount_paise} > 0`,
    ),
  ],
);

export type Receipt = typeof crmPaymentReceipts.$inferSelect;
export type ReceivableEntry = typeof crmReceivableEntries.$inferSelect;
/**
 * ACC-002. Receipt value is allocated, reserved as credit funding, moved to
 * another customer, or free. One definition, used by allocation, credit
 * issue, the account summary and the invariant review.
 */
export class ReceiptBalance {
  constructor(
    readonly receivedPaise: number,
    readonly allocatedPaise: number,
    readonly reservedPaise: number,
    readonly movedPaise: number,
  ) {}
  get freePaise() {
    return safe(
      this.receivedPaise -
        this.allocatedPaise -
        this.reservedPaise -
        this.movedPaise,
    );
  }
  /** Value the receipt still represents for its own customer (the M_i of the reconciliation). */
  get netReceivedPaise() {
    return safe(this.receivedPaise - this.movedPaise);
  }
}
export class ChargeBalance {
  constructor(
    readonly retainedPaise: number,
    readonly cashPaise: number,
    readonly creditPaise: number,
    readonly points: number,
  ) {}
  get outstandingPaise() {
    return safe(
      this.retainedPaise - this.cashPaise - this.creditPaise - this.points,
    );
  }
}
