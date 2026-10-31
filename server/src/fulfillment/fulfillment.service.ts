import { ShipmentQuantity } from './fulfillment.model.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OrdersRepository } from '../orders/orders.repository.js';
import { FulfillmentRepository } from '../fulfillment/fulfillment.repository.js';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { RewardsService } from '../rewards/rewards.service.js';
import { CatalogRepository } from '../catalog/catalog.repository.js';
import { ReturnsRepository } from '../returns/returns.repository.js';
import type { ActionContext as Context, Payload } from '../common/domain.js';
import {
  authorize,
  useOrder,
  fail,
  safe,
  distinct,
  DomainDecision as Decision,
} from '../common/domain.js';

@Injectable()
export class FulfillmentService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly fulfillmentRepository: FulfillmentRepository,
    private readonly accountsRepository: AccountsRepository,
    private readonly accountsService: AccountsService,
    private readonly rewardsService: RewardsService,
    private readonly catalogRepository: CatalogRepository,
    private readonly returnsRepository: ReturnsRepository,
  ) {}
  load(c: Context, p: Payload<'START_LOADING'>) {
    authorize(c, 'WAREHOUSE', 'ADMIN');
    const order = useOrder(c, this.ordersRepository.findById(p.orderId));
    if (
      order.status !== 'APPROVED' ||
      !this.ordersRepository.approvalCount(order.id, order.current_revision)
    )
      fail('APPROVAL_REQUIRED', 'The current revision needs approval');
    distinct(p.items.map((item) => item.lineKey));
    const lines = this.ordersRepository.currentLines(
      order.id,
      order.current_revision,
    );
    const shipmentId = randomUUID();
    c.references.shipmentId = shipmentId;
    this.fulfillmentRepository.insertShipment(c, {
      id: shipmentId,
      order_id: order.id,
      revision: order.current_revision,
      status: 'LOADING',
      original_shipment_id: null,
      correction_id: null,
      created_at: c.now,
      dispatched_at: null,
    });
    for (const item of p.items) {
      const line = lines.find((row) => row.line_key === item.lineKey);
      if (!line)
        fail(
          'LINE_NOT_FOUND',
          'The line does not belong to the current revision',
        );
      const reserved = this.fulfillmentRepository.reservedForLine(
        line.line_key,
        shipmentId,
      );
      const canceled = this.ordersRepository.canceledForLine(line.line_key);
      if (item.qty > line.qty - reserved - canceled)
        fail('QUANTITY_EXCEEDED', 'Loading exceeds the unshipped quantity');
      this.fulfillmentRepository.insertShipmentLine(c, {
        id: randomUUID(),
        shipment_id: shipmentId,
        order_id: order.id,
        line_key: line.line_key,
        sku_id: line.sku_id,
        loaded_qty: item.qty,
        dispatched_qty: 0,
        unit_price_paise: line.unit_price_paise,
        points_per_unit: line.points_per_unit,
      });
    }
  }
  dispatch(c: Context, p: Payload<'DISPATCH_SHIPMENT'>) {
    authorize(c, 'WAREHOUSE', 'ADMIN');
    const order = useOrder(c, this.ordersRepository.findById(p.orderId));
    const shipment = this.fulfillmentRepository.findForOrder(
      p.shipmentId,
      order.id,
    );
    if (!shipment || shipment.status !== 'LOADING')
      fail('SHIPMENT_STATE', 'Select a shipment that is loading');
    if (
      order.status !== 'APPROVED' ||
      shipment.revision !== order.current_revision ||
      !this.ordersRepository.approvalCount(order.id, order.current_revision)
    )
      fail('APPROVAL_REQUIRED', 'The loading document needs current approval');
    this.fulfillmentRepository.updateShipment(c, shipment.id, {
      status: 'DISPATCHED',
      dispatched_at: c.now,
    });
    for (const line of this.fulfillmentRepository.linesForShipment(shipment.id))
      this.fulfillmentRepository.updateShipmentLine(c, line.id, {
        dispatched_qty: line.loaded_qty,
      });
  }
  deliver(c: Context, p: Payload<'CONFIRM_DELIVERY'>) {
    authorize(c, 'WAREHOUSE', 'ADMIN');
    const order = useOrder(c, this.ordersRepository.findById(p.orderId));
    const shipment = this.fulfillmentRepository.findForOrder(
      p.shipmentId,
      order.id,
    );
    if (!shipment || shipment.status !== 'DISPATCHED')
      fail('SHIPMENT_STATE', 'Select an open dispatched shipment');
    distinct(p.items.map((item) => item.shipmentLineId));
    for (const item of p.items) {
      const line = this.fulfillmentRepository.findInShipment(
        item.shipmentLineId,
        shipment.id,
      );
      if (!line)
        fail(
          'LINE_NOT_FOUND',
          'The shipment line does not belong to this shipment',
        );
      const delivered = this.fulfillmentRepository.deliveredForShipmentLine(
        line.id,
      );
      new ShipmentQuantity(line.dispatched_qty, delivered).assertDeliverable(
        item.qty,
      );
      const deliveryId = randomUUID();
      this.fulfillmentRepository.insertDelivery(c, {
        id: deliveryId,
        shipment_line_id: line.id,
        order_id: order.id,
        qty: item.qty,
        action_id: c.id,
        created_at: c.now,
      });
      this.accountsRepository.insertCharge(c, {
        id: randomUUID(),
        customer_id: c.customerId,
        order_id: order.id,
        line_key: line.line_key,
        shipment_line_id: line.id,
        kind: 'DELIVERY',
        amount_paise: safe(item.qty * line.unit_price_paise),
        adjusts_id: null,
        source_id: deliveryId,
        action_id: c.id,
        created_at: c.now,
      });
    }
    const remaining = this.fulfillmentRepository.undeliveredForShipment(
      shipment.id,
    );
    if (!remaining)
      this.fulfillmentRepository.updateShipment(c, shipment.id, {
        status: 'DELIVERED',
      });

    this.accountsService.allocateCash(c, c.customerId);

    this.rewardsService.refresh(c, c.customerId);
  }
  /**
   * FDSK-170. Lower the delivered quantity of shipment lines to what really
   * arrived. History is kept (WF-001): each correction is a negative delivery
   * naming the confirmation it reduces, with one negative goods charge
   * (WF-005). Anything that now over-settles that charge is given back to its
   * source (WF-003). Cash is not re-allocated (WF-002); points are re-derived.
   */
  correctDelivery(c: Context, p: Payload<'CORRECT_DELIVERY'>) {
    authorize(c, 'KAM', 'ADMIN');
    const order = useOrder(c, this.ordersRepository.findById(p.orderId));
    const shipment = this.fulfillmentRepository.findForOrder(
      p.shipmentId,
      order.id,
    );
    if (!shipment || !['DISPATCHED', 'DELIVERED'].includes(shipment.status))
      fail('SHIPMENT_STATE', 'Select a dispatched or delivered shipment');
    distinct(p.items.map((item) => item.shipmentLineId));
    const questions: Array<{
      key: string;
      prompt: string;
      options: Array<{ id: string; label: string }>;
    }> = [];
    const plan = p.items.map((item) => {
      const line = this.fulfillmentRepository.findInShipment(
        item.shipmentLineId,
        shipment.id,
      );
      if (!line)
        fail(
          'LINE_NOT_FOUND',
          'The shipment line does not belong to this shipment',
        );
      const delivered = this.fulfillmentRepository.deliveredForShipmentLine(
        line.id,
      );
      const reduction = delivered - item.deliveredQty;
      if (reduction <= 0)
        fail(
          'NOTHING_TO_CORRECT',
          'The corrected quantity must be below the delivered quantity; confirm further deliveries separately',
        );
      if (
        item.deliveredQty < this.returnsRepository.returnedForShipmentLine(line.id)
      )
        fail(
          'BELOW_RETURNED',
          'Delivered units cannot fall below the units already returned',
        );
      // A confirmation can only give back the units that its charge still carries.
      const candidates = this.fulfillmentRepository
        .confirmationsForShipmentLine(line.id)
        .map((row) => {
          const charge = this.accountsRepository.chargesForDelivery(row.id)[0];
          const carried = charge
            ? Math.floor(
                (charge.amount_paise +
                  this.accountsRepository.adjustmentsForCharge(charge.id)) /
                  line.unit_price_paise,
              )
            : 0;
          return { ...row, charge, correctable: Math.min(row.standing, carried) };
        })
        .filter((row) => row.correctable > 0);
      const chosen = item.confirmationId
        ? candidates.find((row) => row.id === item.confirmationId)
        : candidates.length === 1
          ? candidates[0]
          : undefined;
      if (item.confirmationId && !chosen)
        fail(
          'CONFIRMATION_NOT_FOUND',
          'Select a confirmation of this line that still has delivered units',
        );
      if (!chosen)
        questions.push({
          key: `confirmation:${line.id}`,
          prompt: `Which confirmation of ${line.line_key.slice(0, 8)} was overstated?`,
          options: candidates.map((row) => ({
            id: row.id,
            label: `${row.created_at} · ${row.correctable} units`,
          })),
        });
      else if (reduction > chosen.correctable)
        fail(
          'QUANTITY_EXCEEDED',
          'The correction exceeds the units of the selected confirmation',
        );
      return { line, chosen, reduction };
    });
    if (questions.length) throw new Decision(questions);
    for (const { line, chosen, reduction } of plan) {
      const correctionId = randomUUID();
      c.references.deliveryCorrectionId = correctionId;
      this.fulfillmentRepository.insertDelivery(c, {
        id: correctionId,
        shipment_line_id: line.id,
        order_id: order.id,
        qty: -reduction,
        reverses_delivery_id: chosen!.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.accountsService.reduceCharge(
        c,
        chosen!.charge!,
        safe(reduction * line.unit_price_paise),
        { kind: 'DELIVERY_CORRECTION', sourceId: correctionId },
      );
    }
    if (
      shipment.status === 'DELIVERED' &&
      this.fulfillmentRepository.undeliveredForShipment(shipment.id)
    )
      this.fulfillmentRepository.updateShipment(c, shipment.id, {
        status: 'DISPATCHED',
      });

    this.rewardsService.refresh(c, c.customerId);
  }
  correct(c: Context, p: Payload<'CORRECT_DISPATCHED_ORDER'>) {
    authorize(c, 'KAM', 'ADMIN');
    const order = useOrder(c, this.ordersRepository.findById(p.orderId));
    const shipments = this.fulfillmentRepository.dispatchedForOrderDocuments(
      order.id,
    );
    if (!shipments.length)
      fail(
        'ORDER_NOT_DISPATCHED',
        'Use an ordinary commercial edit before dispatch',
      );
    if (!p.location || (p.location === 'EXISTING_SHIPMENT' && !p.shipmentId))
      throw new Decision([
        {
          key: 'shipment',
          prompt: 'Where were these additional units physically dispatched?',
          options: [
            ...shipments.map((shipment) => ({
              id: shipment.id,
              label: `Existing dispatch ${shipment.id.slice(0, 8)}`,
            })),
            {
              id: 'NEW_SHIPMENT',
              label: 'A separate shipment with its own dispatch time',
            },
          ],
        },
      ]);
    const original =
      p.location === 'EXISTING_SHIPMENT'
        ? shipments.find((row) => row.id === p.shipmentId)
        : undefined;
    if (p.location === 'EXISTING_SHIPMENT' && !original)
      fail(
        'SHIPMENT_NOT_FOUND',
        'Select a dispatched shipment belonging to this order',
      );
    if (
      p.location === 'NEW_SHIPMENT' &&
      (!p.dispatchedAt || Date.parse(p.dispatchedAt) > Date.now())
    )
      fail(
        'DISPATCH_TIME_REQUIRED',
        'Provide the actual past dispatch time for the separate shipment',
      );
    distinct(p.items.map((item) => item.skuId));
    for (const item of p.items)
      if (item.deliveredQty > item.qty)
        fail(
          'QUANTITY_EXCEEDED',
          'Delivered units cannot exceed corrected dispatched units',
        );
    const correctionId = randomUUID(),
      revisionId = randomUUID(),
      shipmentId = randomUUID();
    c.references.correctionId = correctionId;
    c.references.shipmentId = shipmentId;
    const oldLines = this.ordersRepository.currentLines(
      order.id,
      order.current_revision,
    );
    const additions = p.items.map((item) => {
      const sku = this.catalogRepository.findById(item.skuId);
      if (!sku) fail('SKU_NOT_FOUND', 'Select an existing SKU');
      const line = oldLines.find((row) => row.sku_id === sku.id);
      if (line && line.unit_price_paise !== item.unitPricePaise)
        fail(
          'PRICE_MISMATCH',
          'Additional units of an existing line must retain its agreed price',
        );
      return { ...item, sku, lineKey: line?.line_key ?? randomUUID() };
    });
    this.ordersRepository.insertRevision(c, {
      id: revisionId,
      order_id: order.id,
      revision: order.current_revision + 1,
      actor_id: c.actor.id,
      reason: p.reason,
      created_at: c.now,
    });
    for (const line of oldLines)
      this.ordersRepository.insertLine(c, {
        id: randomUUID(),
        revision_id: revisionId,
        order_id: order.id,
        line_key: line.line_key,
        sku_id: line.sku_id,
        qty: safe(
          line.qty +
            (additions.find((item) => item.skuId === line.sku_id)?.qty ?? 0),
        ),
        unit_price_paise: line.unit_price_paise,
        points_per_unit: line.points_per_unit,
      });
    for (const item of additions)
      if (!oldLines.some((line) => line.sku_id === item.skuId))
        this.ordersRepository.insertLine(c, {
          id: randomUUID(),
          revision_id: revisionId,
          order_id: order.id,
          line_key: item.lineKey,
          sku_id: item.skuId,
          qty: item.qty,
          unit_price_paise: item.unitPricePaise,
          points_per_unit: item.sku.points_per_unit,
        });
    for (const loading of this.fulfillmentRepository.loadingForOrder(
      order.id,
    )) {
      this.fulfillmentRepository.updateShipment(c, loading.id, {
        status: 'VOIDED',
      });
    }
    this.fulfillmentRepository.insertCorrection(c, {
      id: correctionId,
      order_id: order.id,
      original_revision: order.current_revision,
      new_revision: order.current_revision + 1,
      actor_id: c.actor.id,
      reason: p.reason,
      evidence: p.evidence,
      authorization_reference: p.authorizationReference,
      location: p.location,
      shipment_id: original?.id ?? null,
      action_id: c.id,
      created_at: c.now,
    });
    this.ordersRepository.insertApproval(c, {
      id: randomUUID(),
      order_id: order.id,
      revision: order.current_revision + 1,
      actor_id: c.actor.id,
      decision: 'APPROVED',
      reason: p.authorizationReference,
      created_at: c.now,
    });
    this.ordersRepository.updateOrder(c, order.id, {
      status: 'APPROVED',
      current_revision: order.current_revision + 1,
    });
    this.fulfillmentRepository.insertShipment(c, {
      id: shipmentId,
      order_id: order.id,
      revision: order.current_revision + 1,
      status: additions.every((item) => item.deliveredQty === item.qty)
        ? 'DELIVERED'
        : 'DISPATCHED',
      original_shipment_id: original?.id ?? null,
      correction_id: correctionId,
      created_at: c.now,
      dispatched_at: original?.dispatched_at ?? p.dispatchedAt!,
    });
    for (const item of additions) {
      const lineId = randomUUID();
      this.fulfillmentRepository.insertShipmentLine(c, {
        id: lineId,
        shipment_id: shipmentId,
        order_id: order.id,
        line_key: item.lineKey,
        sku_id: item.skuId,
        loaded_qty: item.qty,
        dispatched_qty: item.qty,
        unit_price_paise: item.unitPricePaise,
        points_per_unit: item.sku.points_per_unit,
      });
      if (item.deliveredQty) {
        const deliveryId = randomUUID();
        this.fulfillmentRepository.insertDelivery(c, {
          id: deliveryId,
          shipment_line_id: lineId,
          order_id: order.id,
          qty: item.deliveredQty,
          action_id: c.id,
          created_at: c.now,
        });
        this.accountsRepository.insertCharge(c, {
          id: randomUUID(),
          customer_id: c.customerId,
          order_id: order.id,
          line_key: item.lineKey,
          shipment_line_id: lineId,
          kind: 'CORRECTION',
          amount_paise: safe(item.deliveredQty * item.unitPricePaise),
          adjusts_id: null,
          source_id: deliveryId,
          action_id: c.id,
          created_at: c.now,
        });
      }
    }

    this.accountsService.allocateCash(c, c.customerId);

    this.rewardsService.refresh(c, c.customerId);
  }
  forOrder(orderId: string) {
    if (!this.ordersRepository.findById(orderId))
      throw new NotFoundException('Order not found');
    return this.fulfillmentRepository.forOrder(orderId).map((shipment) => ({
      ...shipment,
      lines: this.fulfillmentRepository
        .linesForShipment(shipment.id)
        .map((line) => ({
          ...line,
          delivered: this.fulfillmentRepository.deliveredForShipmentLine(
            line.id,
          ),
          returned: this.returnsRepository.returnedForShipmentLine(line.id),
        })),
    }));
  }
}
