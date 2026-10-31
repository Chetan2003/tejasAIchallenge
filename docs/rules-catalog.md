# Rule sheet

_Generated from `server/src/rules/action-catalog.ts` by `pnpm rules:doc`. Do not edit by hand; a test fails if this file and the catalog disagree._

Admin may run every action below. Each action runs inside one transaction. After it, the system checks every account it touched (quantities, money, credit, points) and refuses to commit if any check fails.

## Actions

| Action | Who (besides Admin) | What it does | Canonical rules | What happens afterwards |
| ------ | ------------------- | ------------ | --------------- | ----------------------- |
| `UPDATE_CUSTOMER` | Sales, Accounts | Change customer name/code. | — | — |
| `PUNCH_ORDER` | Sales | Create a draft commercial revision. | CAT-002, ORD-005 | — |
| `EDIT_ORDER` | Sales | Replace the current commercial terms with a new revision. | ORD-003, ORD-005, ORD-006 | — |
| `SUBMIT_ORDER` | Sales | Submit a revision for commercial review. | ORD-005 | — |
| `APPROVE_ORDER` | KAM | Approve the exact current revision. | ORD-005, REW-001 | — |
| `REJECT_ORDER` | KAM | Reject the exact current revision with a reason. | ORD-005 | — |
| `CANCEL_REMAINDER` | Sales | Cancel selected or all eligible unshipped demand. | ORD-004, ORD-006, REW-001 | After unshipped demand is canceled: recomputes the customer’s points from cash and retained units. |
| `START_LOADING` | Warehouse | Reserve units in a loading batch. | FUL-003, FUL-004 | — |
| `DISPATCH_SHIPMENT` | Warehouse | Confirm that the loaded batch left the warehouse. | FUL-003, FUL-005 | — |
| `CONFIRM_DELIVERY` | Warehouse | Confirm some or all remaining dispatched units. | FUL-006, WF-005 | After delivery of goods is confirmed: allocates the customer’s free cash to their oldest charges; then recomputes the customer’s points from cash and retained units. |
| `RECORD_RETURN` | Warehouse | Receive delivered units back; record an explicit deduction. | RET-001, RET-002, WF-003 | After a physical return is settled: allocates the customer’s free cash to their oldest charges; then recomputes the customer’s points from cash and retained units. |
| `CORRECT_DISPATCHED_ORDER` | KAM | Record authorized additional dispatched goods. | WF-004, WF-005 | After additional dispatched goods are recorded: allocates the customer’s free cash to their oldest charges; then recomputes the customer’s points from cash and retained units. |
| `CORRECT_DELIVERY` | KAM | Lower an overstated delivery confirmation to what really arrived. | FUL-001, FUL-006, WF-001, WF-003, WF-006 | After a delivery confirmation is lowered: recomputes the customer’s points from cash and retained units. |
| `RECEIVE_CUSTOMER_PAYMENT` | Accounts | Capture customer cash and allocate eligible value. | ACC-002, ACC-003 | After a payment is recorded for the customer: allocates the customer’s free cash to their oldest charges; then recomputes the customer’s points from cash and retained units. |
| `ALLOCATE_PAYMENT` | Accounts | Allocate existing free cash. | ACC-003 | After Accounts asks to allocate free cash: allocates the customer’s free cash to their oldest charges; then recomputes the customer’s points from cash and retained units. |
| `MOVE_CUSTOMER_PAYMENT` | Accounts | Move a payment recorded against the wrong customer to the right one. | CUS-001, ACC-002, ACC-004, WF-001 | After a payment recorded for the customer is moved away: recomputes the customer’s points from cash and retained units.<br>After a payment is recorded for the customer: allocates the customer’s free cash to their oldest charges; then recomputes the customer’s points from cash and retained units. |
| `ISSUE_CREDIT_NOTE` | Accounts | Reserve free receipt value as explicit credit. | CRD-001, CRD-002 | — |
| `APPLY_CREDIT_NOTE` | Accounts | Settle a selected charge with credit. | CRD-003 | — |
| `REFUND_CREDIT_NOTE` | Accounts | Record a payout from available credit. | CRD-004 | — |
| `REVERSE_CREDIT_APPLICATION` | Accounts | Undo an eligible amount of a recorded application. | CRD-005, CRD-006 | — |
| `REVERSE_CREDIT_REFUND` | Accounts | Undo an eligible amount of a recorded payout. | CRD-005, CRD-006 | — |
| `REDEEM_POINTS` | Sales, Accounts | Settle a charge with available points. | REW-004 | — |

## What follows what

Cash is allocated before points are recomputed, for each affected customer. Rules: **WF-002**, **REW-001..003**.

| Event | Allocates free cash (WF-002) | Recomputes points (REW-001..003) |
| ----- | :--------------------------: | :------------------------------: |
| a payment is recorded for the customer | yes | yes |
| Accounts asks to allocate free cash | yes | yes |
| delivery of goods is confirmed | yes | yes |
| additional dispatched goods are recorded | yes | yes |
| a physical return is settled | yes | yes |
| unshipped demand is canceled | — | yes |
| a delivery confirmation is lowered | — | yes |
| a payment recorded for the customer is moved away | — | yes |
