import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil, Plus, Truck, XCircle } from 'lucide-react';
import type {
  CommandType,
  CustomerSnapshot,
  OrderDetail,
} from '@crm/shared/crm';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorNotice, Loading } from '@/components/feedback';
import { useCrm, useRecord } from '@/features/crm/context';
import { ActivityDialog } from '@/features/crm/activity-dialog';
import {
  ActivityList,
  date,
  Empty,
  Metric,
  money,
  PageHeader,
  Status,
  Table,
  Tabs,
} from '@/features/crm/ui';

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const { data: bootstrap, actor, refresh } = useCrm();
  const record = useRecord<OrderDetail>(`/crm/orders/${id}`);
  const customerId = record.data?.order.customer_id;
  const account = useRecord<CustomerSnapshot>(
    customerId ? `/crm/customers/${customerId}/snapshot` : '',
  );
  const [tab, setTab] = useState('items');
  const [action, setAction] = useState<{
    type: CommandType;
    shipmentId?: string;
  } | null>(null);
  const detail = record.data;
  if (record.error || account.error)
    return <ErrorNotice message={record.error || account.error} />;
  if (!detail) return <Loading label="Loading order…" />;
  const { order, lines, shipments } = detail;
  const customer = account.data?.summary.customer;
  const sales = ['ADMIN', 'SALES'].includes(actor.role);
  const commercial = ['ADMIN', 'KAM'].includes(actor.role);
  const warehouse = ['ADMIN', 'WAREHOUSE'].includes(actor.role);
  const dispatched = shipments.some((shipment) => shipment.dispatched_at);
  const canceled = order.status === 'CANCELLED';
  const open = lines.reduce((sum, line) => sum + line.open, 0);
  const ready = Boolean(account.data) && !record.loading && !account.loading;
  return (
    <div className="space-y-6">
      <PageHeader
        title={order.number}
        description={`${customer?.name ?? 'Customer order'} · Created ${date(order.created_at)}`}
        back={{ to: '/orders', label: 'Sales orders' }}
      >
        <Button variant="outline" onClick={refresh}>
          Refresh
        </Button>
        {sales && !dispatched && !canceled && (
          <Button asChild variant="outline">
            <Link to={`/orders/${id}/edit`}>
              <Pencil />
              Edit order
            </Link>
          </Button>
        )}
        {sales && open > 0 && !canceled && (
          <Button
            variant="outline"
            disabled={!ready}
            onClick={() => setAction({ type: 'CANCEL_REMAINDER' })}
          >
            <XCircle />
            Cancel items
          </Button>
        )}
        {sales &&
          ['DRAFT', 'REJECTED', 'REAPPROVAL_REQUIRED'].includes(
            order.status,
          ) && (
            <Button
              disabled={!ready}
              onClick={() => setAction({ type: 'SUBMIT_ORDER' })}
            >
              Submit for approval
            </Button>
          )}
        {commercial &&
          ['PENDING', 'REAPPROVAL_REQUIRED'].includes(order.status) && (
            <>
              <Button
                variant="outline"
                disabled={!ready}
                onClick={() => setAction({ type: 'REJECT_ORDER' })}
              >
                Reject
              </Button>
              <Button
                disabled={!ready}
                onClick={() => setAction({ type: 'APPROVE_ORDER' })}
              >
                Approve order
              </Button>
            </>
          )}
        {warehouse &&
          order.status === 'APPROVED' &&
          lines.some((line) => line.open > line.loaded) && (
            <Button
              disabled={!ready}
              onClick={() => setAction({ type: 'START_LOADING' })}
            >
              <Plus />
              Prepare shipment
            </Button>
          )}
      </PageHeader>
      <Card>
        <div className="grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Customer</p>
            <Link
              className="mt-1 block font-medium text-primary hover:underline"
              to={`/customers/${order.customer_id}`}
            >
              {customer?.name ?? 'View customer'}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              {customer?.code}
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs text-muted-foreground">Order status</p>
            <Status value={order.status} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Commercial revision</p>
            <p className="mt-1 font-medium">
              Revision {order.current_revision}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Order value</p>
            <p className="mt-1 font-semibold tabular-nums">
              {money(
                lines.reduce(
                  (sum, line) => sum + line.qty * line.unitPricePaise,
                  0,
                ),
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Before cancellations and returns
            </p>
          </div>
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Ordered units"
          value={lines.reduce((sum, line) => sum + line.qty, 0)}
        />
        <Metric
          label="Delivered units"
          value={lines.reduce((sum, line) => sum + line.delivered, 0)}
        />
        <Metric label="Unshipped units" value={open} />
        <Metric
          label="Canceled / returned"
          value={`${lines.reduce((sum, line) => sum + line.canceled, 0)} / ${lines.reduce((sum, line) => sum + line.returned, 0)}`}
        />
      </div>
      <Card className="overflow-hidden">
        <Tabs
          items={[
            ['items', 'Order items'],
            [
              'shipments',
              `Shipments (${shipments.filter((row) => row.status !== 'VOIDED').length})`,
            ],
            ['history', 'Revisions & approvals'],
            ['activity', 'Activity'],
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'items' && (
          <>
            <Table
              columns={[
                'Product',
                'Ordered',
                'Unit price',
                'Amount',
                'Shipped',
                'Delivered',
                'Canceled',
                'Returned',
                'Unshipped',
              ]}
            >
              {lines.map((line) => (
                <tr key={line.lineKey}>
                  <td className="min-w-44">
                    <p className="font-medium">{line.name}</p>
                    <p className="text-xs text-muted-foreground">{line.code}</p>
                  </td>
                  <td>{line.qty}</td>
                  <td>{money(line.unitPricePaise)}</td>
                  <td>{money(line.qty * line.unitPricePaise)}</td>
                  <td>{line.dispatched}</td>
                  <td>{line.delivered}</td>
                  <td>{line.canceled}</td>
                  <td>{line.returned}</td>
                  <td>{line.open}</td>
                </tr>
              ))}
            </Table>
            <div className="flex flex-wrap justify-between gap-4 border-t bg-muted/20 px-5 py-4 text-sm">
              <p className="text-muted-foreground">
                Charges are recorded for confirmed delivered quantities.
              </p>
              <Link
                className="text-primary hover:underline"
                to={`/customers/${customerId}?tab=account`}
              >
                View customer account
              </Link>
            </div>
          </>
        )}
        {tab === 'shipments' && (
          <div className="divide-y">
            {shipments.length ? (
              shipments.map((shipment, index) => (
                <section key={shipment.id} className="p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Truck className="size-5 text-muted-foreground" />
                      <div>
                        <h3 className="text-sm font-semibold">
                          Shipment {index + 1}
                          {shipment.original_shipment_id ? ' · Supplement' : ''}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Revision {shipment.revision}
                          {shipment.dispatched_at
                            ? ` · Dispatched ${date(shipment.dispatched_at)}`
                            : ''}
                        </p>
                      </div>
                      <Status value={shipment.status} />
                    </div>
                    {warehouse && shipment.status === 'LOADING' && (
                      <Button
                        size="sm"
                        disabled={!ready}
                        onClick={() =>
                          setAction({
                            type: 'DISPATCH_SHIPMENT',
                            shipmentId: shipment.id,
                          })
                        }
                      >
                        Dispatch shipment
                      </Button>
                    )}
                    {commercial &&
                      ['DISPATCHED', 'DELIVERED'].includes(shipment.status) &&
                      shipment.lines.some(
                        (line) => line.delivered > line.returned,
                      ) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!ready}
                          onClick={() =>
                            setAction({
                              type: 'CORRECT_DELIVERY',
                              shipmentId: shipment.id,
                            })
                          }
                        >
                          Correct delivered quantity
                        </Button>
                      )}
                    {warehouse && shipment.status === 'DISPATCHED' && (
                      <Button
                        size="sm"
                        disabled={!ready}
                        onClick={() =>
                          setAction({
                            type: 'CONFIRM_DELIVERY',
                            shipmentId: shipment.id,
                          })
                        }
                      >
                        Confirm delivery
                      </Button>
                    )}
                  </div>
                  <div className="rounded-lg border">
                    <Table
                      columns={[
                        'Product',
                        'Loaded',
                        'Dispatched',
                        'Delivered',
                        'Returned',
                      ]}
                    >
                      {shipment.lines.map((line) => (
                        <tr key={line.id}>
                          <td>
                            {bootstrap?.skus.find(
                              (sku) => sku.id === line.sku_id,
                            )?.name ?? 'Product'}
                          </td>
                          <td>{line.loaded_qty}</td>
                          <td>{line.dispatched_qty}</td>
                          <td>{line.delivered}</td>
                          <td>{line.returned}</td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                </section>
              ))
            ) : (
              <Empty
                title="No shipments yet"
                description={
                  order.status === 'APPROVED'
                    ? 'Prepare a shipment for the approved items.'
                    : 'Shipments can be prepared once the current revision is approved.'
                }
              />
            )}
            {dispatched && (
              <div className="flex flex-wrap gap-3 p-5">
                {warehouse &&
                  lines.some((line) => line.delivered > line.returned) && (
                    <Button
                      variant="outline"
                      disabled={!ready}
                      onClick={() => setAction({ type: 'RECORD_RETURN' })}
                    >
                      Record a return
                    </Button>
                  )}
                {commercial && (
                  <Button
                    variant="outline"
                    disabled={!ready}
                    onClick={() =>
                      setAction({ type: 'CORRECT_DISPATCHED_ORDER' })
                    }
                  >
                    Record shipment correction
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        {tab === 'history' && (
          <div className="divide-y">
            {[...detail.revisions].reverse().map((revision) => (
              <section key={revision.id} className="p-5">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold">
                    Revision {revision.revision}
                    {revision.revision === order.current_revision
                      ? ' · Current'
                      : ''}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {revision.reason} · {date(revision.created_at)}
                  </p>
                </div>
                <Table
                  columns={['Product', 'Quantity', 'Unit price', 'Amount']}
                >
                  {revision.lines.map((line) => (
                    <tr key={line.sku_id}>
                      <td>
                        {bootstrap?.skus.find((sku) => sku.id === line.sku_id)
                          ?.name ?? line.sku_id}
                      </td>
                      <td>{line.qty}</td>
                      <td>{money(line.unit_price_paise)}</td>
                      <td>{money(line.qty * line.unit_price_paise)}</td>
                    </tr>
                  ))}
                </Table>
                {detail.approvals
                  .filter((approval) => approval.revision === revision.revision)
                  .map((approval) => (
                    <p
                      className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
                      key={approval.id}
                    >
                      <Status value={approval.decision} />
                      {bootstrap?.actors.find(
                        (user) => user.id === approval.actor_id,
                      )?.name ?? 'Commercial review'}{' '}
                      · {approval.reason}
                    </p>
                  ))}
              </section>
            ))}
          </div>
        )}
        {tab === 'activity' && <ActivityList events={detail.timeline} />}
      </Card>
      {action && account.data && (
        <ActivityDialog
          {...action}
          detail={detail}
          snapshot={account.data}
          onClose={() => {
            if (action.type === 'START_LOADING') setTab('shipments');
            setAction(null);
          }}
        />
      )}
    </div>
  );
}
