import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceDesk } from './support/service-desk.js';

/**
 * FDSK-170. A KAM lowers an overstated delivery confirmation. Numbers use
 * sku-a: 10000 paise a unit and 1000 points per unit, so 10000 paise of cash
 * on a charge earns 1000 points.
 */
describe(
  'FDSK-170 correct an overstated delivery',
  { concurrency: false },
  () => {
    const desk = new ServiceDesk();
    before(() => desk.start());
    after(() => desk.stop());

    const correct = (
      orderId: string,
      shipmentId: string,
      shipmentLineId: string,
      deliveredQty: number,
      confirmationId?: string,
      role: 'KAM' | 'WAREHOUSE' = 'KAM',
    ) =>
      desk.try(
        {
          type: 'CORRECT_DELIVERY',
          payload: {
            orderId,
            shipmentId,
            reason: 'Only part of the consignment reached the customer',
            items: [{ shipmentLineId, deliveredQty, confirmationId }],
          },
        },
        role,
      );

    it('lowers the delivered quantity and the charge, and reopens the shipment for the rest', () => {
      const customerId = desk.customer();
      const orderId = desk.order(customerId);
      const { shipmentId, shipmentLineId } = desk.ship(orderId);
      assert.equal(desk.shipment(orderId, shipmentId).status, 'DELIVERED');

      const result = correct(orderId, shipmentId, shipmentLineId, 6);
      assert.equal(result.status, 'APPLIED', JSON.stringify(result.errors));

      const summary = desk.summary(customerId);
      assert.equal(summary.charges.length, 1);
      assert.equal(summary.charges[0]!.remainingPaise, 60000);
      assert.equal(summary.outstandingPaise, 60000);
      assert.equal(desk.shipmentLine(orderId, shipmentId).delivered, 6);
      assert.equal(desk.shipment(orderId, shipmentId).status, 'DISPATCHED');
      assert.deepEqual(
        result.review?.checks.filter((c) => !c.passed),
        [],
      );

      // Warehouse later confirms the four that were still on the way.
      desk.confirm(orderId, shipmentId, shipmentLineId, 4);
      assert.equal(desk.shipment(orderId, shipmentId).status, 'DELIVERED');
      assert.equal(desk.summary(customerId).outstandingPaise, 100000);
      desk.assertConsistent(customerId);
    });

    it('keeps the confirmation and its charge on record and links the correction to them', () => {
      const customerId = desk.customer();
      const orderId = desk.order(customerId);
      const { shipmentId, shipmentLineId } = desk.ship(orderId);
      const result = correct(orderId, shipmentId, shipmentLineId, 6);
      const inserted = result.effects
        .filter((effect) => effect.operation !== 'UPDATE')
        .map((effect) => effect.entity);
      assert.ok(inserted.includes('deliveries'));
      assert.ok(inserted.includes('receivable_entries'));
      const delivery = result.effects.find((e) => e.entity === 'deliveries')!;
      assert.equal((delivery.after as { qty: number }).qty, -4);
      assert.match(delivery.reason!, /Correct confirmation/);
      // The original charge is untouched; the correction is a separate negative entry.
      const ledger = desk.accounts.ledger(customerId).finance as Array<{
        kind: string;
        amount_paise: number;
      }>;
      assert.deepEqual(
        ledger.map((row) => [row.kind, row.amount_paise]),
        [
          ['DELIVERY', 100000],
          ['DELIVERY_CORRECTION', -40000],
        ],
      );
    });

    it('does not touch cash that still fits inside the lowered charge', () => {
      const customerId = desk.customer();
      const orderId = desk.order(customerId);
      const { shipmentId, shipmentLineId } = desk.ship(orderId);
      desk.receive(customerId, 30000);
      correct(orderId, shipmentId, shipmentLineId, 6);
      const summary = desk.summary(customerId);
      assert.equal(summary.charges[0]!.cashPaidPaise, 30000);
      assert.equal(summary.unappliedCashPaise, 0);
      assert.equal(summary.outstandingPaise, 30000);
      desk.assertConsistent(customerId);
    });

    it('returns over-settled cash to its receipt as an advance, re-derives points, and uses the advance on the next confirmation', () => {
      const customerId = desk.customer();
      const orderId = desk.order(customerId);
      const { shipmentId, shipmentLineId } = desk.ship(orderId);
      desk.receive(customerId, 100000);
      assert.deepEqual(desk.summary(customerId).points, {
        locked: 0,
        available: 10000,
        redeemed: 0,
        clawbackPending: 0,
      });

      const result = correct(orderId, shipmentId, shipmentLineId, 6);
      assert.equal(result.status, 'APPLIED', JSON.stringify(result.errors));
      let summary = desk.summary(customerId);
      assert.equal(summary.charges[0]!.cashPaidPaise, 60000);
      assert.equal(
        summary.unappliedCashPaise,
        40000,
        'released cash is free again',
      );
      assert.equal(summary.outstandingPaise, 0);
      assert.deepEqual(summary.points, {
        locked: 4000,
        available: 6000,
        redeemed: 0,
        clawbackPending: 0,
      });

      // WF-002: the next delivery confirmation allocates the advance.
      desk.confirm(orderId, shipmentId, shipmentLineId, 4);
      summary = desk.summary(customerId);
      assert.equal(summary.unappliedCashPaise, 0);
      assert.equal(summary.outstandingPaise, 0);
      assert.deepEqual(summary.points, {
        locked: 0,
        available: 10000,
        redeemed: 0,
        clawbackPending: 0,
      });
      desk.assertConsistent(customerId);
    });

    it('turns points that were already spent into clawback pending', () => {
      const customerId = desk.customer();
      const first = desk.order(customerId);
      const { shipmentId, shipmentLineId } = desk.ship(first);
      desk.receive(customerId, 100000);
      const second = desk.order(customerId, 5);
      desk.ship(second);
      const charge = desk
        .summary(customerId)
        .charges.find((row) => row.order_id === second)!;
      desk.do(
        {
          type: 'REDEEM_POINTS',
          payload: { customerId, chargeId: charge.id, points: 8000 },
        },
        'ACCOUNTS',
      );

      correct(first, shipmentId, shipmentLineId, 6);
      const summary = desk.summary(customerId);
      assert.deepEqual(summary.points, {
        locked: 9000,
        available: 0,
        redeemed: 8000,
        clawbackPending: 2000,
      });
      // Released cash is an advance; the second order's charge is not auto-settled.
      assert.equal(summary.unappliedCashPaise, 40000);
      desk.assertConsistent(customerId);
    });

    it('gives back credit applied to the lowered charge', () => {
      const customerId = desk.customer();
      desk.receive(customerId, 30000);
      desk.do(
        {
          type: 'ISSUE_CREDIT_NOTE',
          payload: {
            customerId,
            amountPaise: 30000,
            reason: 'Advance held as credit',
          },
        },
        'ACCOUNTS',
      );
      const orderId = desk.order(customerId);
      const { shipmentId, shipmentLineId } = desk.ship(orderId);
      const note = desk.summary(customerId).credits[0]!;
      const charge = desk.summary(customerId).charges[0]!;
      desk.do(
        {
          type: 'APPLY_CREDIT_NOTE',
          payload: {
            customerId,
            creditNoteId: note.id,
            chargeId: charge.id,
            amountPaise: 30000,
          },
        },
        'ACCOUNTS',
      );
      assert.equal(desk.summary(customerId).credits[0]!.availablePaise, 0);

      const result = correct(orderId, shipmentId, shipmentLineId, 2);
      assert.equal(result.status, 'APPLIED', JSON.stringify(result.errors));
      const summary = desk.summary(customerId);
      assert.equal(summary.charges[0]!.remainingPaise, 20000);
      assert.equal(summary.credits[0]!.availablePaise, 10000);
      assert.equal(summary.outstandingPaise, 0);
      desk.assertConsistent(customerId);
    });

    it('asks which confirmation was overstated when a line has several, then applies the answer', () => {
      const customerId = desk.customer();
      const orderId = desk.order(customerId);
      const { shipmentId, shipmentLineId } = desk.ship(orderId, [4, 6]);

      const asked = correct(orderId, shipmentId, shipmentLineId, 7);
      assert.equal(asked.status, 'NEEDS_DECISION');
      assert.equal(asked.decisions.length, 1);
      assert.equal(asked.decisions[0]!.options.length, 2);
      assert.equal(
        desk.shipmentLine(orderId, shipmentId).delivered,
        10,
        'nothing written',
      );

      const newest = asked.decisions[0]!.options[1]!.id;
      const answered = correct(orderId, shipmentId, shipmentLineId, 7, newest);
      assert.equal(answered.status, 'APPLIED', JSON.stringify(answered.errors));
      const summary = desk.summary(customerId);
      assert.deepEqual(
        summary.charges.map((charge) => charge.remainingPaise),
        [40000, 30000],
      );
      desk.assertConsistent(customerId);
    });

    it('rejects corrections that do not fit the chosen confirmation, or that name an unknown one', () => {
      const customerId = desk.customer();
      const orderId = desk.order(customerId);
      const { shipmentId, shipmentLineId } = desk.ship(orderId, [4, 6]);
      const options = correct(orderId, shipmentId, shipmentLineId, 7)
        .decisions[0]!.options;
      const tooBig = correct(
        orderId,
        shipmentId,
        shipmentLineId,
        3,
        options[1]!.id,
      );
      assert.equal(tooBig.status, 'REJECTED');
      assert.equal(tooBig.errors[0]!.code, 'QUANTITY_EXCEEDED');
      const unknown = correct(orderId, shipmentId, shipmentLineId, 7, 'nope');
      assert.equal(unknown.errors[0]!.code, 'CONFIRMATION_NOT_FOUND');
      assert.equal(desk.shipmentLine(orderId, shipmentId).delivered, 10);
    });

    it('enforces 0 <= returned <= delivered <= dispatched (FUL-001)', () => {
      const customerId = desk.customer();
      const orderId = desk.order(customerId);
      const { shipmentId, shipmentLineId } = desk.ship(orderId);
      desk.do(
        {
          type: 'RECORD_RETURN',
          payload: {
            orderId,
            items: [{ shipmentLineId, qty: 4 }],
            feePaise: 0,
            reason: 'Customer sent four cartons back',
          },
        },
        'WAREHOUSE',
      );
      assert.equal(
        correct(orderId, shipmentId, shipmentLineId, 3).errors[0]!.code,
        'BELOW_RETURNED',
      );
      assert.equal(
        correct(orderId, shipmentId, shipmentLineId, 10).errors[0]!.code,
        'NOTHING_TO_CORRECT',
      );
      assert.equal(
        correct(orderId, shipmentId, shipmentLineId, 12).errors[0]!.code,
        'NOTHING_TO_CORRECT',
      );
      // Down to exactly the returned units is allowed; the charge is fully released.
      const ok = correct(orderId, shipmentId, shipmentLineId, 4);
      assert.equal(ok.status, 'APPLIED', JSON.stringify(ok.errors));
      assert.equal(desk.summary(customerId).charges[0]!.remainingPaise, 0);
      desk.assertConsistent(customerId);
    });

    it('is reserved for KAM (and Admin) and for dispatched shipments', () => {
      const customerId = desk.customer();
      const orderId = desk.order(customerId);
      const { shipmentId, shipmentLineId } = desk.ship(orderId);
      const forbidden = correct(
        orderId,
        shipmentId,
        shipmentLineId,
        6,
        undefined,
        'WAREHOUSE',
      );
      assert.equal(forbidden.status, 'REJECTED');
      assert.equal(forbidden.errors[0]!.code, 'FORBIDDEN');
      assert.equal(desk.shipmentLine(orderId, shipmentId).delivered, 10);

      const other = desk.order(customerId);
      const line = desk.orders.detail(other).lines[0]!;
      const loading = desk.do(
        {
          type: 'START_LOADING',
          payload: {
            orderId: other,
            items: [{ lineKey: line.lineKey, qty: 2 }],
          },
        },
        'WAREHOUSE',
      ).references.shipmentId!;
      const lineId = desk.shipmentLine(other, loading).id;
      assert.equal(
        correct(other, loading, lineId, 1).errors[0]!.code,
        'SHIPMENT_STATE',
      );
    });
  },
);
