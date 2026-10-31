import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Role, User } from '@crm/shared';
import type { ActionResult, CrmCommand } from '@crm/shared/crm';
import { DatabaseService } from '../../src/database/database.service.js';
import { ActionsService } from '../../src/actions/actions.service.js';
import { CustomersService } from '../../src/customers/customers.service.js';
import { OrdersService } from '../../src/orders/orders.service.js';
import { AccountsService } from '../../src/accounts/accounts.service.js';
import { AuditService } from '../../src/audit/audit.service.js';
import { UsersRepository } from '../../src/users/users.repository.js';
import { UsersService } from '../../src/users/users.service.js';
import { configureApp } from '../../src/configure-app.js';
import { seedReferenceData } from '../../src/scripts/seed-reference-data.js';

/**
 * A booted application on a throwaway database with the business helpers the
 * scenario tests share: act as a role, create a customer, take an order all
 * the way to confirmed delivery, receive cash.
 */
export class ServiceDesk {
  readonly directory = mkdtempSync(join(tmpdir(), 'crm-desk-'));
  app!: INestApplication;
  actions!: ActionsService;
  customers!: CustomersService;
  orders!: OrdersService;
  accounts!: AccountsService;
  audit!: AuditService;
  admin!: User;
  private staff: User[] = [];

  async start() {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = join(this.directory, 'crm.db');
    process.env.JWT_SECRET = 'crm-test-secret-'.repeat(4);
    process.env.CLIENT_ORIGIN = 'http://localhost:5173';
    const { AppModule } = await import('../../src/app.module.js');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    this.app = module.createNestApplication({ logger: false });
    configureApp(this.app);
    const database = this.app.get(DatabaseService);
    migrate(database.db, { migrationsFolder: resolve('drizzle') });
    this.actions = this.app.get(ActionsService);
    this.customers = this.app.get(CustomersService);
    this.orders = this.app.get(OrdersService);
    this.accounts = this.app.get(AccountsService);
    this.audit = this.app.get(AuditService);
    this.admin = await this.app.get(UsersService).create({
      name: 'Desk Admin',
      email: 'desk@example.test',
      password: 'desk-test-password-123',
      role: 'ADMIN',
    });
    await this.app.init();
    seedReferenceData(database, this.admin);
    this.staff = this.app.get(UsersRepository).listActive();
  }

  async stop() {
    await this.app?.close();
    rmSync(this.directory, { recursive: true, force: true });
  }

  customer(label = 'Desk customer') {
    return this.customers.createCustomer(this.admin, {
      name: label,
      code: randomUUID(),
    }).id;
  }

  /** Submit a command as the first active staff member holding `role`. */
  try(command: CrmCommand, role: Role): ActionResult {
    const payload = command.payload;
    return this.actions.execute(
      {
        command,
        actorId: this.staff.find((actor) => actor.role === role)!.id,
        expectedVersion:
          'orderId' in payload
            ? this.orders.detail(payload.orderId).order.version
            : this.accounts.summary(payload.customerId).customer.version,
        idempotencyKey: randomUUID(),
      },
      this.admin,
    );
  }

  /** Like `try`, but the action must be applied. */
  do(command: CrmCommand, role: Role): ActionResult {
    const result = this.try(command, role);
    assert.equal(result.status, 'APPLIED', JSON.stringify(result.errors));
    return result;
  }

  /** Create, submit and approve an order for `customerId`. */
  order(customerId: string, qty = 10, unitPricePaise = 10000, skuId = 'sku-a') {
    const created = this.do(
      {
        type: 'PUNCH_ORDER',
        payload: { customerId, items: [{ skuId, qty, unitPricePaise }] },
      },
      'SALES',
    );
    const orderId = created.references.orderId!;
    this.do({ type: 'SUBMIT_ORDER', payload: { orderId } }, 'SALES');
    this.do(
      { type: 'APPROVE_ORDER', payload: { orderId, revision: 1 } },
      'KAM',
    );
    return orderId;
  }

  /** Load and dispatch everything open on the order; optionally confirm delivery in `confirmations`. */
  ship(orderId: string, confirmations: number[] | 'all' = 'all') {
    const line = this.orders.detail(orderId).lines[0]!;
    const loaded = this.do(
      {
        type: 'START_LOADING',
        payload: {
          orderId,
          items: [{ lineKey: line.lineKey, qty: line.open }],
        },
      },
      'WAREHOUSE',
    );
    const shipmentId = loaded.references.shipmentId!;
    this.do(
      { type: 'DISPATCH_SHIPMENT', payload: { orderId, shipmentId } },
      'WAREHOUSE',
    );
    const shipmentLine = this.shipmentLine(orderId, shipmentId);
    const quantities =
      confirmations === 'all' ? [shipmentLine.dispatched_qty] : confirmations;
    for (const qty of quantities)
      this.confirm(orderId, shipmentId, shipmentLine.id, qty);
    return { shipmentId, shipmentLineId: shipmentLine.id };
  }

  confirm(
    orderId: string,
    shipmentId: string,
    shipmentLineId: string,
    qty: number,
  ) {
    return this.do(
      {
        type: 'CONFIRM_DELIVERY',
        payload: { orderId, shipmentId, items: [{ shipmentLineId, qty }] },
      },
      'WAREHOUSE',
    );
  }

  shipmentLine(orderId: string, shipmentId: string) {
    return this.orders
      .detail(orderId)
      .shipments.find((row) => row.id === shipmentId)!.lines[0]!;
  }

  shipment(orderId: string, shipmentId: string) {
    return this.orders
      .detail(orderId)
      .shipments.find((row) => row.id === shipmentId)!;
  }

  receive(customerId: string, amountPaise: number, reference = 'BANK-TEST') {
    return this.do(
      {
        type: 'RECEIVE_CUSTOMER_PAYMENT',
        payload: { customerId, amountPaise, reference },
      },
      'ACCOUNTS',
    );
  }

  summary(customerId: string) {
    return this.accounts.summary(customerId);
  }

  /** Every invariant the application checks before commit, asserted explicitly. */
  assertConsistent(customerId: string) {
    const review = this.audit.review(customerId);
    const failed = review.checks.filter((check) => !check.passed);
    assert.deepEqual(
      failed.map((check) => `${check.label}: ${check.details}`),
      [],
    );
  }
}
