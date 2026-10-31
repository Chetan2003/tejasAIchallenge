import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CommandType, CustomerSnapshot } from '@crm/shared/crm';
import { Button } from '@/components/ui/button';
import { useCrm } from './context';
import { ActivityDialog } from './activity-dialog';
import { activityLabels, date, Empty, Metric, money, Table, Tabs } from './ui';

export function AccountPanel({
  snapshot,
  rewards = false,
}: {
  snapshot: CustomerSnapshot;
  rewards?: boolean;
}) {
  const { actor, data } = useCrm();
  const [tab, setTab] = useState('receipts');
  const [action, setAction] = useState<{
    type: CommandType;
    entryId?: string;
  } | null>(null);
  const accounts = ['ADMIN', 'ACCOUNTS'].includes(actor.role);
  const redeem = ['ADMIN', 'SALES', 'ACCOUNTS'].includes(actor.role);
  const { summary, ledger } = snapshot;
  const orderLink = (id: unknown) => {
    const order = snapshot.orders.find((row) => row.order.id === id);
    return order ? (
      <Link
        className="text-primary hover:underline"
        to={`/orders/${order.order.id}`}
      >
        {order.order.number}
      </Link>
    ) : (
      '—'
    );
  };
  const detailLabel = (kind: unknown) =>
    ({
      DELIVERY: 'Delivered goods',
      CORRECTION: 'Shipment correction',
      RETURN: 'Returned goods',
      RETURN_FEE: 'Return deduction',
    })[String(kind) as 'DELIVERY'] ?? String(kind);
  const reversed = (
    rows: Array<Record<string, unknown>>,
    id: unknown,
    field = 'amount_paise',
  ) =>
    rows
      .filter((row) => row.reversal_of_id === id)
      .reduce((sum, row) => sum + Number(row[field]), 0);
  return (
    <div>
      {rewards ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h2 className="font-semibold">Reward points</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Earned, locked, redeemed, and pending recovery.
              </p>
            </div>
            {redeem && (
              <Button
                variant="outline"
                disabled={
                  summary.points.available <= 0 ||
                  summary.points.clawbackPending > 0 ||
                  summary.outstandingPaise <= 0
                }
                onClick={() => setAction({ type: 'REDEEM_POINTS' })}
              >
                Redeem points
              </Button>
            )}
          </div>
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Available"
              value={summary.points.available.toLocaleString()}
            />
            <Metric
              label="Locked"
              value={summary.points.locked.toLocaleString()}
            />
            <Metric
              label="Redeemed"
              value={summary.points.redeemed.toLocaleString()}
            />
            <Metric
              label="Pending recovery"
              value={summary.points.clawbackPending.toLocaleString()}
            />
          </div>
          {ledger.rewards.length ? (
            <Table columns={['Date', 'Activity', 'Balance', 'Points']}>
              {[...ledger.rewards].reverse().map((row) => (
                <tr key={String(row.id)}>
                  <td>{date(row.created_at)}</td>
                  <td>
                    {activityLabels[
                      snapshot.timeline.find(
                        (event) => event.action_id === row.action_id,
                      )?.type ?? ''
                    ] ?? 'Reward adjustment'}
                  </td>
                  <td>
                    {String(row.bucket).replaceAll('_', ' ').toLowerCase()}
                  </td>
                  <td className="tabular-nums">
                    {Number(row.points_delta) > 0 ? '+' : ''}
                    {Number(row.points_delta).toLocaleString()}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="No reward activity yet" />
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h2 className="font-semibold">
                Account balance: {money(summary.netBalancePaise)}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {summary.netBalancePaise < 0
                  ? 'Balance in the customer’s favor.'
                  : 'Net amount due from the customer.'}
              </p>
            </div>
            {accounts && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={summary.unappliedCashPaise <= 0}
                  onClick={() => setAction({ type: 'ISSUE_CREDIT_NOTE' })}
                >
                  Reserve credit
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    summary.unappliedCashPaise <= 0 ||
                    summary.outstandingPaise <= 0
                  }
                  onClick={() => setAction({ type: 'ALLOCATE_PAYMENT' })}
                >
                  Allocate cash
                </Button>
                <Button
                  onClick={() =>
                    setAction({ type: 'RECEIVE_CUSTOMER_PAYMENT' })
                  }
                >
                  Record payment
                </Button>
              </div>
            )}
          </div>
          <Tabs
            items={[
              ['receipts', 'Payments'],
              ['charges', 'Charges'],
              ['credits', 'Credit notes'],
              ['settlements', 'Applications & refunds'],
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === 'receipts' &&
            (ledger.receipts.length ? (
              <Table
                columns={['Received', 'Payment reference', 'Amount', 'Status']}
              >
                {[...ledger.receipts].reverse().map((row) => {
                  const movedAway = ledger.receiptMoves.find(
                    (move) => move.receipt_id === row.id,
                  );
                  const movedIn = ledger.receiptMoves.find(
                    (move) => move.to_receipt_id === row.id,
                  );
                  const customerName = (id: unknown) =>
                    data?.customers.find((customer) => customer.id === id)
                      ?.name ?? 'another customer';
                  return (
                    <tr key={String(row.id)}>
                      <td>{date(row.created_at)}</td>
                      <td className="font-medium">{String(row.reference)}</td>
                      <td>{money(Number(row.amount_paise))}</td>
                      <td>
                        {movedAway ? (
                          <span className="text-muted-foreground">
                            Moved to {customerName(movedAway.to_customer_id)}
                          </span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {movedIn && (
                              <span className="text-muted-foreground">
                                Moved from{' '}
                                {customerName(movedIn.from_customer_id)}
                              </span>
                            )}
                            {accounts && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setAction({
                                    type: 'MOVE_CUSTOMER_PAYMENT',
                                    entryId: String(row.id),
                                  })
                                }
                              >
                                Move to another customer
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            ) : (
              <Empty
                title="No payments recorded"
                description="Record receipts against this customer account."
              />
            ))}
          {tab === 'charges' &&
            (ledger.finance.length ? (
              <Table
                columns={[
                  'Date',
                  'Order',
                  'Description',
                  'Amount',
                  'Outstanding',
                ]}
              >
                {[...ledger.finance].reverse().map((row) => (
                  <tr key={String(row.id)}>
                    <td>{date(row.created_at)}</td>
                    <td>{orderLink(row.order_id)}</td>
                    <td>{detailLabel(row.kind)}</td>
                    <td>{money(Number(row.amount_paise))}</td>
                    <td>
                      {Number(row.amount_paise) > 0
                        ? money(
                            summary.charges.find(
                              (charge) => charge.id === row.id,
                            )?.outstandingPaise ?? 0,
                          )
                        : '—'}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty
                title="No charges yet"
                description="Charges appear when delivered quantities are confirmed."
              />
            ))}
          {tab === 'credits' &&
            (summary.credits.length ? (
              <Table
                columns={[
                  'Credit note',
                  'Reason',
                  'Issued',
                  'Applied',
                  'Refunded',
                  'Available',
                  '',
                ]}
              >
                {summary.credits.map((credit, index) => (
                  <tr key={credit.id}>
                    <td className="whitespace-nowrap font-medium">
                      Credit {index + 1}
                    </td>
                    <td className="min-w-40">{credit.reason}</td>
                    <td>{money(credit.amount_paise)}</td>
                    <td>{money(credit.appliedPaise)}</td>
                    <td>{money(credit.refundedPaise)}</td>
                    <td className="font-medium">
                      {money(credit.availablePaise)}
                    </td>
                    <td>
                      {accounts && credit.availablePaise > 0 && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={summary.outstandingPaise <= 0}
                            onClick={() =>
                              setAction({
                                type: 'APPLY_CREDIT_NOTE',
                                entryId: credit.id,
                              })
                            }
                          >
                            Apply
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setAction({
                                type: 'REFUND_CREDIT_NOTE',
                                entryId: credit.id,
                              })
                            }
                          >
                            Refund
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty
                title="No credit notes"
                description="Credit notes from returns or reserved unapplied cash appear here."
              />
            ))}
          {tab === 'settlements' && (
            <>
              <div className="border-b px-5 py-4 text-sm font-semibold">
                Credit applications
              </div>
              {ledger.creditApplications.length ? (
                <Table columns={['Date', 'Order', 'Amount', 'Type', '']}>
                  {[...ledger.creditApplications].reverse().map((row) => {
                    const net = ledger.creditApplications
                      .filter(
                        (item) =>
                          item.credit_note_id === row.credit_note_id &&
                          item.charge_id === row.charge_id,
                      )
                      .reduce(
                        (sum, item) => sum + Number(item.amount_paise),
                        0,
                      );
                    const available = Math.min(
                      Number(row.amount_paise) +
                        reversed(ledger.creditApplications, row.id),
                      net,
                    );
                    return (
                      <tr key={String(row.id)}>
                        <td>{date(row.created_at)}</td>
                        <td>
                          {orderLink(
                            summary.charges.find(
                              (charge) => charge.id === row.charge_id,
                            )?.order_id,
                          )}
                        </td>
                        <td>{money(Number(row.amount_paise))}</td>
                        <td>
                          {Number(row.amount_paise) < 0
                            ? 'Reversal'
                            : 'Applied credit'}
                        </td>
                        <td>
                          {accounts &&
                            Number(row.amount_paise) > 0 &&
                            available > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setAction({
                                    type: 'REVERSE_CREDIT_APPLICATION',
                                    entryId: String(row.id),
                                  })
                                }
                              >
                                Reverse
                              </Button>
                            )}
                        </td>
                      </tr>
                    );
                  })}
                </Table>
              ) : (
                <Empty title="No credit applications" />
              )}
              <div className="border-y px-5 py-4 text-sm font-semibold">
                Refunds
              </div>
              {ledger.refunds.length ? (
                <Table
                  columns={['Date', 'Bank reference', 'Amount', 'Type', '']}
                >
                  {[...ledger.refunds].reverse().map((row) => (
                    <tr key={String(row.id)}>
                      <td>{date(row.created_at)}</td>
                      <td>{String(row.reference)}</td>
                      <td>{money(Number(row.amount_paise))}</td>
                      <td>
                        {Number(row.amount_paise) < 0 ? 'Reversal' : 'Refund'}
                      </td>
                      <td>
                        {accounts &&
                          Number(row.amount_paise) > 0 &&
                          Number(row.amount_paise) +
                            reversed(ledger.refunds, row.id) >
                            0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setAction({
                                  type: 'REVERSE_CREDIT_REFUND',
                                  entryId: String(row.id),
                                })
                              }
                            >
                              Reverse
                            </Button>
                          )}
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty title="No refunds recorded" />
              )}
            </>
          )}
        </>
      )}
      {!rewards && (
        <details className="m-5 rounded-lg border p-4 text-sm">
          <summary className="cursor-pointer font-medium">
            Balance checks ·{' '}
            {snapshot.review.checks.filter((check) => check.passed).length} of{' '}
            {snapshot.review.checks.length} passed
          </summary>
          <p className="mt-3 text-xs text-muted-foreground">
            Checked at {new Date(snapshot.review.checkedAt).toLocaleString()} ·
            Customer version {snapshot.review.customerVersion}
          </p>
          <ul className="mt-3 divide-y">
            {snapshot.review.checks.map((check) => (
              <li key={check.id} className="py-3">
                <p
                  className={
                    check.passed ? 'text-emerald-700' : 'text-destructive'
                  }
                >
                  {check.passed ? 'Passed' : 'Failed'} · {check.label}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {check.details}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {action && (
        <ActivityDialog
          {...action}
          snapshot={snapshot}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  );
}
