import { RewardEntitlement } from './rewards.model.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CustomersRepository } from '../customers/customers.repository.js';
import { RewardsRepository } from '../rewards/rewards.repository.js';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { CreditsRepository } from '../credits/credits.repository.js';
import { OrdersRepository } from '../orders/orders.repository.js';
import { ReturnsRepository } from '../returns/returns.repository.js';
import type { ActionContext as Context, Payload } from '../common/domain.js';
import { useCustomer, fail, safe } from '../common/domain.js';

@Injectable()
export class RewardsService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly rewardsRepository: RewardsRepository,
    private readonly accountsRepository: AccountsRepository,
    private readonly creditsRepository: CreditsRepository,
    private readonly ordersRepository: OrdersRepository,
    private readonly returnsRepository: ReturnsRepository,
  ) {}
  redeem(c: Context, p: Payload<'REDEEM_POINTS'>) {
    useCustomer(c, this.customersRepository.findById(p.customerId));
    const balance = this.rewardsRepository.availableForCustomer(c.customerId);
    const debt = this.rewardsRepository.debtForCustomer(c.customerId);
    if (debt || p.points > balance)
      fail('POINTS_UNAVAILABLE', 'There are not enough available points');
    const charge = this.accountsRepository.findCustomerCharge(
      p.chargeId,
      c.customerId,
    );
    if (!charge)
      fail(
        'CHARGE_NOT_FOUND',
        'Select an outstanding charge belonging to this customer',
      );
    const due =
      charge.amount_paise +
      this.accountsRepository.adjustmentsForCharge(charge.id) -
      this.accountsRepository.cashForCharge(charge.id) -
      this.creditsRepository.appliedToCharge(charge.id) -
      this.rewardsRepository.redeemedForCharge(charge.id);
    if (p.points > due)
      fail('AMOUNT_EXCEEDED', 'The redemption exceeds the outstanding charge');
    this.rewardsRepository.insertRedemption(c, {
      id: randomUUID(),
      customer_id: c.customerId,
      charge_id: charge.id,
      points: p.points,
      action_id: c.id,
      created_at: c.now,
    });
    this.rewardsRepository.insertPosting(c, {
      id: randomUUID(),
      customer_id: c.customerId,
      line_key: null,
      bucket: 'AVAILABLE',
      points_delta: -p.points,
      source_id: charge.id,
      action_id: c.id,
      created_at: c.now,
    });
    this.rewardsRepository.insertPosting(c, {
      id: randomUUID(),
      customer_id: c.customerId,
      line_key: null,
      bucket: 'REDEEMED',
      points_delta: p.points,
      source_id: charge.id,
      action_id: c.id,
      created_at: c.now,
    });
  }
  refresh(c: Context, customerId: string) {
    for (const orderRow of this.ordersRepository.forCustomer(customerId)) {
      for (const lineRow of this.ordersRepository.currentLines(
        orderRow.id,
        orderRow.current_revision,
      )) {
        const canceledQty = this.ordersRepository.canceledForLine(
          lineRow.line_key,
        );
        const returnedQty = this.returnsRepository.returnedForLine(
          lineRow.line_key,
        );
        const entitled = RewardEntitlement.retained(
          orderRow.status === 'APPROVED',
          lineRow.qty,
          canceledQty,
          returnedQty,
          lineRow.points_per_unit,
        );
        let earned = 0;
        for (const chargeRow of this.accountsRepository.chargesForLine(
          lineRow.line_key,
        )) {
          const qualifyingCash = this.accountsRepository.cashForCharge(
            chargeRow.id,
          );
          earned = safe(
            earned +
              RewardEntitlement.cashEarned(
                qualifyingCash,
                lineRow.points_per_unit,
                lineRow.unit_price_paise,
              ),
          );
        }
        earned = Math.min(entitled, earned);
        const previousEarned = this.rewardsRepository.earnedForLine(
          lineRow.line_key,
        );
        if (earned !== previousEarned)
          this.rewardsRepository.insertPosting(c, {
            id: randomUUID(),
            customer_id: customerId,
            line_key: lineRow.line_key,
            bucket: 'AVAILABLE',
            points_delta: earned - previousEarned,
            source_id: c.id,
            action_id: c.id,
            created_at: c.now,
          });
        const previousLocked = this.rewardsRepository.lockedForLine(
          lineRow.line_key,
        );
        if (entitled - earned !== previousLocked)
          this.rewardsRepository.insertPosting(c, {
            id: randomUUID(),
            customer_id: customerId,
            line_key: lineRow.line_key,
            bucket: 'LOCKED',
            points_delta: entitled - earned - previousLocked,
            source_id: c.id,
            action_id: c.id,
            created_at: c.now,
          });
      }
    }
    const spendable = this.rewardsRepository.availableForCustomer(customerId);
    const outstandingClawback =
      this.rewardsRepository.debtForCustomer(customerId);
    if (spendable < 0) {
      this.rewardsRepository.insertPosting(c, {
        id: randomUUID(),
        customer_id: customerId,
        line_key: null,
        bucket: 'AVAILABLE',
        points_delta: -spendable,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.rewardsRepository.insertPosting(c, {
        id: randomUUID(),
        customer_id: customerId,
        line_key: null,
        bucket: 'CLAWBACK_PENDING',
        points_delta: -spendable,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
    } else if (outstandingClawback > 0 && spendable > 0) {
      const offset = Math.min(outstandingClawback, spendable);
      this.rewardsRepository.insertPosting(c, {
        id: randomUUID(),
        customer_id: customerId,
        line_key: null,
        bucket: 'AVAILABLE',
        points_delta: -offset,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.rewardsRepository.insertPosting(c, {
        id: randomUUID(),
        customer_id: customerId,
        line_key: null,
        bucket: 'CLAWBACK_PENDING',
        points_delta: -offset,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
    }
  }
  balances(customerId: string) {
    return {
      locked: this.rewardsRepository.lockedForCustomer(customerId),
      available: this.rewardsRepository.availableForCustomer(customerId),
      redeemed: this.rewardsRepository.spentForCustomer(customerId),
      clawbackPending: this.rewardsRepository.debtForCustomer(customerId),
    };
  }
  forCustomer(customerId: string) {
    if (!this.customersRepository.findById(customerId))
      throw new NotFoundException('Customer not found');
    return {
      points: this.balances(customerId),
      entries: this.rewardsRepository.entriesForCustomer(customerId),
      redemptions: this.rewardsRepository.redemptionsForCustomer(customerId),
    };
  }
}
