import { ChargeBalance, ReceiptBalance } from './accounts.model.js';
import type { ReceivableEntry, Receipt } from './accounts.model.js';
import { CreditBalance } from '../credits/credits.model.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CustomerSummary,
  LedgerView,
  CustomerAccountRow,
} from '@crm/shared/crm';
import { CustomersRepository } from '../customers/customers.repository.js';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { RewardsService } from '../rewards/rewards.service.js';
import { CreditsRepository } from '../credits/credits.repository.js';
import { RewardsRepository } from '../rewards/rewards.repository.js';
import { ReturnsRepository } from '../returns/returns.repository.js';
import { FulfillmentRepository } from '../fulfillment/fulfillment.repository.js';
import { DatabaseService } from '../database/database.service.js';
import type { ActionContext as Context, Payload } from '../common/domain.js';
import { useCustomer, emit, fail, safe } from '../common/domain.js';

@Injectable()
export class AccountsService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly accountsRepository: AccountsRepository,
    private readonly rewardsService: RewardsService,
    private readonly creditsRepository: CreditsRepository,
    private readonly rewardsRepository: RewardsRepository,
    private readonly returnsRepository: ReturnsRepository,
    private readonly fulfillmentRepository: FulfillmentRepository,
    private readonly database: DatabaseService,
  ) {}
  receive(c: Context, p: Payload<'RECEIVE_CUSTOMER_PAYMENT'>) {
    useCustomer(c, this.customersRepository.findById(p.customerId));
    const receiptId = randomUUID();
    c.references.receiptId = receiptId;
    this.accountsRepository.insertReceipt(c, {
      id: receiptId,
      customer_id: c.customerId,
      amount_paise: p.amountPaise,
      reference: p.reference,
      action_id: c.id,
      created_at: c.now,
    });

    emit(c, 'PAYMENT_RECEIVED');
  }
  allocate(c: Context, p: Payload<'ALLOCATE_PAYMENT'>) {
    useCustomer(c, this.customersRepository.findById(p.customerId));

    emit(c, 'CASH_ALLOCATION_REQUESTED');
  }
  /**
   * WF-003 core, shared by every operation that lowers a charge after it was
   * posted (returns, delivery corrections). Appends a signed adjustment, then
   * releases whatever now over-settles the charge in canonical order: cash,
   * then credit, then points. Each release is a signed entry that restores the
   * amount to its original source. Returns the released cash per receipt, in
   * release order, so the caller decides what that cash becomes.
   */
  reduceCharge(
    c: Context,
    charge: ReceivableEntry,
    reduction: number,
    adjustment: { kind: string; sourceId: string },
  ): Map<string, number> {
    const face =
      charge.amount_paise +
      this.accountsRepository.adjustmentsForCharge(charge.id);
    this.accountsRepository.insertCharge(c, {
      id: randomUUID(),
      customer_id: charge.customer_id,
      order_id: charge.order_id,
      line_key: charge.line_key,
      shipment_line_id: charge.shipment_line_id,
      kind: adjustment.kind,
      amount_paise: -reduction,
      adjusts_id: charge.id,
      source_id: adjustment.sourceId,
      action_id: c.id,
      created_at: c.now,
    });
    const cash = this.accountsRepository.cashForCharge(charge.id);
    const credits = this.creditsRepository.appliedToCharge(charge.id);
    const points = this.rewardsRepository.redeemedForCharge(charge.id);
    let overage = Math.max(0, cash + credits + points - (face - reduction));
    const released = new Map<string, number>();
    for (const allocation of this.accountsRepository.cashByReceiptForCharge(
      charge.id,
    )) {
      const take = Math.min(overage, allocation.n);
      if (!take) continue;
      this.accountsRepository.insertAllocation(c, {
        id: randomUUID(),
        customer_id: charge.customer_id,
        receipt_id: allocation.receipt_id,
        charge_id: charge.id,
        amount_paise: -take,
        action_id: c.id,
        created_at: c.now,
      });
      released.set(
        allocation.receipt_id,
        (released.get(allocation.receipt_id) ?? 0) + take,
      );
      overage -= take;
    }
    for (const application of this.creditsRepository.creditByNoteForCharge(
      charge.id,
    )) {
      const take = Math.min(overage, application.n);
      if (!take) continue;
      this.creditsRepository.insertApplication(c, {
        id: randomUUID(),
        customer_id: charge.customer_id,
        credit_note_id: application.credit_note_id,
        charge_id: charge.id,
        amount_paise: -take,
        action_id: c.id,
        created_at: c.now,
      });
      overage -= take;
    }
    if (overage > 0) {
      if (overage > points)
        fail(
          'SETTLEMENT_MISMATCH',
          'The change cannot be settled against its source documents',
        );
      this.rewardsRepository.insertRedemption(c, {
        id: randomUUID(),
        customer_id: charge.customer_id,
        charge_id: charge.id,
        points: -overage,
        action_id: c.id,
        created_at: c.now,
      });
      for (const [bucket, delta] of [
        ['AVAILABLE', overage],
        ['REDEEMED', -overage],
      ] as const)
        this.rewardsRepository.insertPosting(c, {
          id: randomUUID(),
          customer_id: charge.customer_id,
          line_key: null,
          bucket,
          points_delta: delta,
          source_id: adjustment.sourceId,
          action_id: c.id,
          created_at: c.now,
        });
    }
    return released;
  }
  /**
   * FDSK-169. A payment was recorded against the wrong customer. The receipt
   * stays on record (WF-001): its cash is released from the wrong customer's
   * charges with signed allocations, a receipt_moves document consumes its
   * value (ACC-004), and the same payment is recorded on the right customer,
   * where it is allocated by cash priority (WF-002). Points follow cash: the
   * wrong customer loses what the cash had earned, the right customer earns it.
   */
  moveReceipt(c: Context, p: Payload<'MOVE_CUSTOMER_PAYMENT'>) {
    useCustomer(c, this.customersRepository.findById(p.customerId));
    const receipt = this.accountsRepository.findReceipt(p.receiptId);
    if (!receipt || receipt.customer_id !== c.customerId)
      fail(
        'RECEIPT_NOT_FOUND',
        'Select a payment recorded against this customer',
      );
    const target = this.customersRepository.findById(p.toCustomerId);
    if (!target) fail('NOT_FOUND', 'Customer not found');
    if (target.id === receipt.customer_id)
      fail('SAME_CUSTOMER', 'Choose a different customer for the payment');
    const balance = this.receiptBalance(receipt);
    if (balance.movedPaise > 0)
      fail('RECEIPT_ALREADY_MOVED', 'This payment has already been moved');
    if (balance.reservedPaise > 0)
      fail(
        'RECEIPT_CREDIT_FUNDED',
        'This payment funds a credit note, and credit cannot leave the customer’s account',
      );
    for (const allocation of this.accountsRepository.cashByChargeForReceipt(
      receipt.id,
    ))
      this.accountsRepository.insertAllocation(c, {
        id: randomUUID(),
        customer_id: receipt.customer_id,
        receipt_id: receipt.id,
        charge_id: allocation.charge_id,
        amount_paise: -allocation.n,
        action_id: c.id,
        created_at: c.now,
      });
    const movedId = randomUUID();
    c.references.receiptId = movedId;
    this.accountsRepository.insertReceipt(c, {
      id: movedId,
      customer_id: target.id,
      amount_paise: receipt.amount_paise,
      reference: receipt.reference,
      action_id: c.id,
      created_at: c.now,
    });
    this.accountsRepository.insertReceiptMove(c, {
      id: randomUUID(),
      receipt_id: receipt.id,
      to_receipt_id: movedId,
      from_customer_id: receipt.customer_id,
      to_customer_id: target.id,
      amount_paise: receipt.amount_paise,
      reason: p.reason,
      action_id: c.id,
      created_at: c.now,
    });

    emit(c, 'PAYMENT_RELEASED', receipt.customer_id);
    emit(c, 'PAYMENT_RECEIVED', target.id);
  }
  /** ACC-002: where a receipt's value currently sits. The single definition of free cash. */
  receiptBalance(receipt: Receipt) {
    return new ReceiptBalance(
      receipt.amount_paise,
      this.accountsRepository.allocatedFromReceipt(receipt.id),
      this.creditsRepository.reservedFromReceipt(receipt.id),
      this.accountsRepository.movedFromReceipt(receipt.id),
    );
  }
  allocateCash(c: Context, customerId: string) {
    for (const receipt of this.accountsRepository.receiptsForCustomer(
      customerId,
    )) {
      let available = this.receiptBalance(receipt).freePaise;
      if (available < 0)
        fail('RECEIPT_MISMATCH', 'Receipt allocations exceed captured funds');
      for (const charge of this.accountsRepository.chargesInDueOrder(
        customerId,
      )) {
        if (!available) break;
        const face =
          charge.amount_paise +
          this.accountsRepository.adjustmentsForCharge(charge.id);
        const cash = this.accountsRepository.cashForCharge(charge.id);
        const credit = this.creditsRepository.appliedToCharge(charge.id);
        const redeemed = this.rewardsRepository.redeemedForCharge(charge.id);
        const take = Math.min(
          available,
          Math.max(0, face - cash - credit - redeemed),
        );
        if (take)
          this.accountsRepository.insertAllocation(c, {
            id: randomUUID(),
            customer_id: customerId,
            receipt_id: receipt.id,
            charge_id: charge.id,
            amount_paise: take,
            action_id: c.id,
            created_at: c.now,
          });
        available -= take;
      }
    }
  }
  summary(customerId: string): CustomerSummary {
    const customer = this.customersRepository.findById(customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    const charges = this.accountsRepository
      .chargesForCustomer(customerId)
      .map((charge) => {
        const remainingPaise =
          charge.amount_paise +
          this.accountsRepository.adjustmentsForCharge(charge.id);
        const cashPaidPaise = this.accountsRepository.cashForCharge(charge.id);
        const credit = this.creditsRepository.appliedToCharge(charge.id);
        const redeemed = this.rewardsRepository.redeemedForCharge(charge.id);
        return {
          ...charge,
          remainingPaise,
          cashPaidPaise,
          outstandingPaise: new ChargeBalance(
            remainingPaise,
            cashPaidPaise,
            credit,
            redeemed,
          ).outstandingPaise,
        };
      });
    const credits = this.creditsRepository
      .creditsForCustomer(customerId)
      .map((note) => {
        const appliedPaise = this.creditsRepository.appliedFromCredit(note.id);
        const refundedPaise = this.creditsRepository.refundedFromCredit(
          note.id,
        );
        return {
          ...note,
          appliedPaise,
          refundedPaise,
          availablePaise: new CreditBalance(
            note.amount_paise,
            appliedPaise,
            refundedPaise,
          ).availablePaise,
        };
      });
    const receipts = this.accountsRepository.receiptsByInsertion(customerId);
    const unappliedCashPaise = safe(
      receipts.reduce(
        (sum, receipt) => sum + this.receiptBalance(receipt).freePaise,
        0,
      ),
    );
    const receivedPaise =
      this.accountsRepository.receivedForCustomer(customerId);
    const refundsPaise = this.creditsRepository.refundedForCustomer(customerId);
    const redemption = this.rewardsRepository.redeemedForCustomer(customerId);
    const netBalancePaise = safe(
      this.accountsRepository.postedForCustomer(customerId) -
        receivedPaise +
        refundsPaise -
        redemption,
    );
    return {
      customer,
      charges,
      credits,
      netBalancePaise,
      unappliedCashPaise,
      receivedPaise,
      refundsPaise,
      outstandingPaise: safe(
        charges.reduce((sum, row) => sum + row.outstandingPaise, 0),
      ),
      creditsOpenPaise: safe(
        credits.reduce((sum, row) => sum + row.availablePaise, 0),
      ),
      points: this.rewardsService.balances(customerId),
    };
  }
  ledger(customerId: string): LedgerView {
    this.summary(customerId);
    return {
      finance: this.accountsRepository.entriesForCustomer(customerId),
      receipts: this.accountsRepository.receiptsByInsertion(customerId),
      receiptMoves: this.accountsRepository.movesForCustomer(customerId),
      allocations: this.accountsRepository.allocationsForCustomer(customerId),
      creditApplications:
        this.creditsRepository.applicationsForCustomer(customerId),
      credits: this.creditsRepository.creditsForCustomer(customerId),
      refunds: this.creditsRepository.refundsForCustomer(customerId),
      redemptions: this.rewardsRepository.redemptionsForCustomer(customerId),
      rewards: this.rewardsRepository.entriesForCustomer(customerId),
      returns: this.returnsRepository.forCustomer(customerId),
      corrections:
        this.fulfillmentRepository.correctionsForCustomer(customerId),
    };
  }
  accounts(): CustomerAccountRow[] {
    return this.database.db.transaction(() =>
      this.customersRepository.list().map((customer) => {
        const summary = this.summary(customer.id);
        return {
          customer,
          netBalancePaise: summary.netBalancePaise,
          outstandingPaise: summary.outstandingPaise,
          unappliedCashPaise: summary.unappliedCashPaise,
          creditsOpenPaise: summary.creditsOpenPaise,
        };
      }),
    );
  }
}
