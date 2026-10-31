# Architecture draft 2: refined

**Status:** superseded by [draft 3](03-post-research-draft.md).
**Written by:** Claude (Sonnet 5.5), prompted by Chetan, 31 Oct 2026. Agent-written.
**Written after:** a second, closer read of `ReturnsService`, `AccountsService.allocateCash`, `RewardsService.refresh`, `AuditService.review` and the Drizzle models. Written before implementation.

Draft 1 left six open questions. This draft answers each from the canonical rules, breaks the work into sub-problems, and sets the data model. It does not yet change the framework. Draft 2 still assumes plain service methods.

## 1. Answers to the open questions

### Q1. Moving a receipt (FDSK-169)

**Decision:** receipts stay immutable. The move is a linked document, `receipt_moves`, and a new receipt on the right customer.

- WF-001 says posted value changes only through "linked additions or compensating entries".
- CUS-001 says settlement cannot cross customers, so the cash must exist as a receipt owned by the right customer. Re-pointing `customer_id` is out.
- ACC-002 already treats a receipt as value that is allocated (`a_i`), reserved for credit (`f_i`) or free (`u_i`). A move is a fourth use of the same value, and credit funding is the precedent for it. The rule becomes:

$$
u_i = m_i - a_i - f_i - t_i \ge 0,\qquad t_i = \text{value moved to another customer}.
$$

- The reconciliation identity in `docs/verification.md` stays true if "receipts received" means $m_i - t_i$ for the source customer. The new receipt on the right customer is an ordinary receipt of that customer.

### Q2. Un-confirming a delivery (FDSK-170)

**Decision:** a delivery correction is a signed `deliveries` row (negative `qty`) with `reverses_delivery_id`. It gets exactly one signed goods charge (WF-005 extended: $\operatorname{value}(\operatorname{charge}(e)) = q_e p_h$ with $q_e<0$ for a correction).

- Allocations, credit applications, refunds, and return adjustments are already signed and linked. Signed rows are the house style for reversals.
- Every existing sum (`deliveredForShipmentLine`, `deliveredForLine`, the `recognized-value` check) then works unchanged.
- The `qty > 0` check becomes `qty <> 0`, via a table-rebuild migration.

### Q3. Actions that touch two customers

**Decision:** the action context keeps one _primary_ customer (`c.customerId`), plus a set of _affected_ customers.

- The engine bumps versions, writes the audit event, and runs the invariant review for **every affected customer**, not only the primary one.
- The reactions (`allocateCash`, `rewards.refresh`) take an explicit customer id instead of reading `c.customerId`.

### Q4. Which confirmation is wrong (rule 7.2 in the brief)

**Decision:** the system asks only when it genuinely cannot tell.

- A correction applies to one confirmation (a positive `deliveries` row with remaining net quantity).
- If the line has exactly one live confirmation, use it.
- If it has several and the request does not name one (`confirmationId`), return a `NEEDS_DECISION` question listing them. This reuses the existing `DomainDecision` mechanism, the one used for "where were the additional units dispatched?".
- The correction must fit inside the chosen confirmation, or it is rejected.

### Q5. Does released cash re-allocate immediately?

**Decision:** no. WF-002 lists the allocation occasions: payment receipt, delivery confirmation, additional-goods correction, completed return settlement, and explicit allocation. "Other operations do not trigger cash allocation."

- A delivery correction is not on the list, so released cash returns to the receipt as free cash (an advance, as for cancellations in the README).
- It is picked up at the next occasion. In the brief's example, that is Warehouse confirming the other four boxes.
- The moved payment on the destination customer **is** a payment receipt, so allocation runs there. Nothing is re-allocated on the source customer.

### Q6. A receipt that already funds a credit note

**Decision:** reject with `RECEIPT_CREDIT_FUNDED`.

- CRD-006 keeps funding reserved forever, even after application or refund. There is no un-funding action.
- Splitting the receipt would invent a new partial-move operation with no basis in the rules.
- This is a documented limitation, not a silent behaviour.

## 2. Sub-problems

| #   | Sub-problem                                                                  | Rules                  | Owner module                                                        |
| --- | ---------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------- |
| S1  | Reduce a charge and give back what over-settles it (cash → credit → points) | WF-003, ACC-001        | Accounts. **Extract from Returns, shared by returns and FDSK-170.** |
| S2  | Signed delivery + one signed charge per confirmation                         | WF-005, FUL-001        | Fulfillment                                                         |
| S3  | Reopen shipment when delivered < dispatched                                  | FUL-006                | Fulfillment                                                         |
| S4  | Pick the confirmation to reduce, or ask                                      | brief 7.2              | Fulfillment                                                         |
| S5  | Release a receipt's allocations, record the move, create the new receipt     | ACC-002, CUS-001, WF-001 | Accounts                                                          |
| S6  | One definition of "free cash" ($u_i$), used by allocation, credit, summary, audit | ACC-002           | Accounts model                                                      |
| S7  | Allocation and reward refresh on the correct customers                       | WF-002, REW-001..003   | Engine                                                              |
| S8  | Versions, audit events and review for all affected customers                 | WF-001                 | Engine                                                              |

## 3. Data model changes (one migration)

```text
deliveries         + reverses_delivery_id TEXT NULL;  qty CHECK  qty > 0  ->  qty <> 0
receipt_moves      id, receipt_id, to_receipt_id, from_customer_id, to_customer_id,
                   amount_paise > 0, reason, action_id, created_at
receivable_entries kind gains DELIVERY_CORRECTION (text column, no schema change)
```

No existing row changes. History is append-only.

## 4. Commands

```text
CORRECT_DELIVERY   role KAM   { orderId, shipmentId, reason,
                                items: [{ shipmentLineId, deliveredQty, confirmationId? }] }
                   uses the order version
MOVE_CUSTOMER_PAYMENT  role ACCOUNTS  { customerId, receiptId, toCustomerId, reason }
                   uses the source customer's version
```

`deliveredQty` is the corrected **total** delivered for that line. A KAM thinks "it should say six", not "subtract four".

## 5. Invariants this must keep

- FUL-001: $0 \le r_h \le d_h \le s_h$ after correction. So the corrected $d_h$ is at least the returned units, and it is strictly lower than before.
- ACC-001: every charge keeps $b_j \ge 0$ after its retained value drops.
- ACC-002: $u_i \ge 0$ for every receipt.
- REW: points are re-derived from cash by the existing `refresh`. A shortfall becomes clawback pending (REW-003). No new points code.
- The pre-commit review already checks all of these. It must run for both customers in FDSK-169.

## 6. Test plan

- FDSK-170: unpaid, paid, credit-settled, points-settled; partial correction; multiple confirmations (ask, then answer); below returned units; shipment reopens; later confirmation re-allocates the advance.
- FDSK-169: allocated, partly allocated, free-only receipt; spent points → clawback; credit-funded rejection; same customer; double move; role and version checks; both customers' reviews pass.

## 7. What I still do not like

The two new actions will add two more `case` arms, two more `authorize(...)` lines, and more copies of the reaction calls. That is the combinatorial problem the brief describes, in miniature. I will first build the plain version, to see how bad it really is, then decide how much framework is justified.
