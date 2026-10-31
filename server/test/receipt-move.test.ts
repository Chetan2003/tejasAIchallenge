import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceDesk } from './support/service-desk.js';

/**
 * FDSK-169. Accounts moves a payment recorded against the wrong customer.
 * sku-a: 10000 paise a unit, 1000 points per unit.
 */
describe(
  'FDSK-169 move a payment to the right customer',
  { concurrency: false },
  () => {
    const desk = new ServiceDesk();
    before(() => desk.start());
    after(() => desk.stop());

    const move = (
      customerId: string,
      receiptId: string,
      toCustomerId: string,
      role: 'ACCOUNTS' | 'WAREHOUSE' = 'ACCOUNTS',
    ) =>
      desk.try(
        {
          type: 'MOVE_CUSTOMER_PAYMENT',
          payload: {
            customerId,
            receiptId,
            toCustomerId,
            reason: 'Bank reference shows Greenfield paid, not Northside',
          },
        },
        role,
      );
    const firstReceipt = (customerId: string) =>
      desk.accounts.ledger(customerId).receipts[0]!.id as string;

    /** Northside has a delivered 100000-paise order; Greenfield has the same, unpaid. */
    function twoCustomers() {
      const northside = desk.customer('Northside');
      const greenfield = desk.customer('Greenfield');
      desk.ship(desk.order(northside));
      desk.ship(desk.order(greenfield));
      return { northside, greenfield };
    }

    it('releases the wrong customer’s charges and settles the right customer’s', () => {
      const { northside, greenfield } = twoCustomers();
      desk.receive(northside, 100000, 'UTR-GREENFIELD-1');
      assert.equal(desk.summary(northside).outstandingPaise, 0);

      const result = move(northside, firstReceipt(northside), greenfield);
      assert.equal(result.status, 'APPLIED', JSON.stringify(result.errors));

      const wrong = desk.summary(northside);
      assert.equal(wrong.charges[0]!.cashPaidPaise, 0);
      assert.equal(wrong.outstandingPaise, 100000);
      assert.equal(wrong.receivedPaise, 0);
      assert.equal(wrong.unappliedCashPaise, 0);
      assert.deepEqual(wrong.points, {
        locked: 10000,
        available: 0,
        redeemed: 0,
        clawbackPending: 0,
      });

      const right = desk.summary(greenfield);
      assert.equal(right.charges[0]!.cashPaidPaise, 100000);
      assert.equal(right.outstandingPaise, 0);
      assert.equal(right.receivedPaise, 100000);
      assert.deepEqual(right.points, {
        locked: 0,
        available: 10000,
        redeemed: 0,
        clawbackPending: 0,
      });
      desk.assertConsistent(northside);
      desk.assertConsistent(greenfield);
    });

    it('keeps the original receipt on record and links it to the new one', () => {
      const { northside, greenfield } = twoCustomers();
      desk.receive(northside, 100000, 'UTR-GREENFIELD-2');
      const original = firstReceipt(northside);
      const result = move(northside, original, greenfield);
      const newReceipt = result.references.receiptId!;

      const kept = desk.accounts.ledger(northside);
      assert.equal(kept.receipts.length, 1, 'the original is not deleted');
      assert.equal(kept.receipts[0]!.amount_paise, 100000);
      const moves = kept.receiptMoves as Array<Record<string, unknown>>;
      assert.equal(moves.length, 1);
      assert.equal(moves[0]!.receipt_id, original);
      assert.equal(moves[0]!.to_receipt_id, newReceipt);
      assert.equal(moves[0]!.to_customer_id, greenfield);

      const carried = desk.accounts.ledger(greenfield).receipts[0]!;
      assert.equal(carried.id, newReceipt);
      assert.equal(
        carried.reference,
        'UTR-GREENFIELD-2',
        'bank reference is kept',
      );
      assert.deepEqual(
        (kept.allocations as Array<{ amount_paise: number }>).map(
          (row) => row.amount_paise,
        ),
        [100000, -100000],
        'the wrong allocation is cancelled by a linked negative entry, not deleted',
      );
    });

    it('moves a payment that is only partly allocated, or not allocated at all', () => {
      const { northside, greenfield } = twoCustomers();
      desk.receive(northside, 150000, 'UTR-PARTLY');
      assert.equal(desk.summary(northside).unappliedCashPaise, 50000);
      move(northside, firstReceipt(northside), greenfield);
      assert.equal(desk.summary(northside).outstandingPaise, 100000);
      assert.equal(desk.summary(northside).unappliedCashPaise, 0);
      assert.equal(desk.summary(greenfield).outstandingPaise, 0);
      assert.equal(desk.summary(greenfield).unappliedCashPaise, 50000);

      const advance = desk.customer('Advance only');
      desk.receive(advance, 40000, 'UTR-ADVANCE');
      const result = move(advance, firstReceipt(advance), greenfield);
      assert.equal(result.status, 'APPLIED', JSON.stringify(result.errors));
      assert.equal(desk.summary(advance).unappliedCashPaise, 0);
      assert.equal(desk.summary(greenfield).unappliedCashPaise, 90000);
      for (const id of [northside, greenfield, advance])
        desk.assertConsistent(id);
    });

    it('turns points that the wrong customer already spent into clawback pending', () => {
      const northside = desk.customer('Northside');
      const greenfield = desk.customer('Greenfield');
      desk.ship(desk.order(northside));
      desk.receive(northside, 100000, 'UTR-SPENT');
      const second = desk.order(northside, 5);
      desk.ship(second);
      const charge = desk
        .summary(northside)
        .charges.find((row) => row.order_id === second)!;
      desk.do(
        {
          type: 'REDEEM_POINTS',
          payload: { customerId: northside, chargeId: charge.id, points: 8000 },
        },
        'ACCOUNTS',
      );

      const result = move(northside, firstReceipt(northside), greenfield);
      assert.equal(result.status, 'APPLIED', JSON.stringify(result.errors));
      assert.deepEqual(desk.summary(northside).points, {
        locked: 15000,
        available: 0,
        redeemed: 8000,
        clawbackPending: 8000,
      });
      desk.assertConsistent(northside);
    });

    it('bumps both customers’ versions and writes an audit event on each', () => {
      const { northside, greenfield } = twoCustomers();
      desk.receive(northside, 100000, 'UTR-AUDIT');
      const before = [northside, greenfield].map(
        (id) => desk.summary(id).customer.version,
      );
      const result = move(northside, firstReceipt(northside), greenfield);
      assert.equal(result.aggregateVersions[northside], before[0]! + 1);
      assert.equal(result.aggregateVersions[greenfield], before[1]! + 1);
      for (const id of [northside, greenfield])
        assert.ok(
          desk.audit
            .customerTimeline(id)
            .some((event) => event.type === 'MOVE_CUSTOMER_PAYMENT'),
        );
    });

    it('lets a moved payment be moved again, but never twice from the same customer', () => {
      const { northside, greenfield } = twoCustomers();
      const third = desk.customer('Third');
      desk.receive(northside, 100000, 'UTR-CHAIN');
      const original = firstReceipt(northside);
      const first = move(northside, original, greenfield);
      assert.equal(
        move(northside, original, third).errors[0]!.code,
        'RECEIPT_ALREADY_MOVED',
      );
      const again = move(greenfield, first.references.receiptId!, third);
      assert.equal(again.status, 'APPLIED', JSON.stringify(again.errors));
      assert.equal(desk.summary(greenfield).receivedPaise, 0);
      assert.equal(desk.summary(third).receivedPaise, 100000);
      for (const id of [northside, greenfield, third])
        desk.assertConsistent(id);
    });

    it('refuses moves it cannot do honestly', () => {
      const { northside, greenfield } = twoCustomers();
      desk.receive(northside, 30000, 'UTR-REFUSE');
      const receipt = firstReceipt(northside);
      assert.equal(
        move(northside, receipt, northside).errors[0]!.code,
        'SAME_CUSTOMER',
      );
      assert.equal(
        move(northside, receipt, 'missing').errors[0]!.code,
        'NOT_FOUND',
      );
      assert.equal(
        move(greenfield, receipt, northside).errors[0]!.code,
        'RECEIPT_NOT_FOUND',
        'the receipt must belong to the customer it is moved from',
      );
      assert.equal(
        move(northside, receipt, greenfield, 'WAREHOUSE').errors[0]!.code,
        'FORBIDDEN',
      );

      const funded = desk.customer('Credit funded');
      desk.receive(funded, 30000, 'UTR-FUNDED');
      desk.do(
        {
          type: 'ISSUE_CREDIT_NOTE',
          payload: {
            customerId: funded,
            amountPaise: 10000,
            reason: 'Hold part of the advance as credit',
          },
        },
        'ACCOUNTS',
      );
      const blocked = move(funded, firstReceipt(funded), greenfield);
      assert.equal(blocked.status, 'REJECTED');
      assert.equal(blocked.errors[0]!.code, 'RECEIPT_CREDIT_FUNDED');
      assert.equal(
        desk.summary(funded).receivedPaise,
        30000,
        'nothing was written',
      );
    });
  },
);
