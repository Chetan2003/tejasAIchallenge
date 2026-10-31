# Architecture draft 1: first pass

**Status:** superseded by [draft 2](02-refined-draft.md).
**Written by:** Claude (Sonnet 5.5), prompted by Chetan, on 31 Oct 2026. Chetan did not supply a draft of his own, so the evolution recorded in this folder is the agent's. It is labelled that way on purpose.
**Written after:** reading the assignment PDF, `docs/candidate-walkthrough/*`, and the actions, accounts, fulfillment, returns, rewards, credits and audit services. Written before any code change and before any outside research.

## 1. What the task is really testing

The repo already splits cleanly into modules. What it does not have is a single place where the business rules live: the same rule fragments are spread across a 300-line `switch` in `ActionsService`, `authorize(...)` calls in every service, and `allocateCash` + `rewards.refresh` calls copied at the end of five handlers. FDSK-169 and FDSK-170 are the probes. Each touches several ledgers at once (receipts, allocations, charges, credits, points) and has to leave every invariant intact.

## 2. First plan

1. Add two commands in the existing style: a zod schema in `shared/src/crm.ts`, a method on the owning service, a `case` in `ActionsService.execute`.
2. Keep every history table append-only (WF-001). Corrections are new, linked rows. Nothing is edited in place.
3. Lean on the invariant review that already runs before every commit (`AuditService.review`). It is the safety net, so the new code can be simple and the net catches mistakes.
4. Write the architecture, framework and decision documents after the features work, not before.

## 3. Sketch of the two features

**FDSK-170, overstated delivery.** The KAM names a shipment line and the true delivered quantity. The system:

- lowers delivered units,
- lowers the goods charge by the same value,
- puts any cash, credit or points that now over-settle the charge back where it came from,
- reopens the shipment so Warehouse can confirm the rest later.

This is the same mechanism as the existing return settlement (WF-003) without the fee and credit note.

**FDSK-169, payment on the wrong customer.** Accounts names a receipt and the right customer. The system:

- removes the receipt's effect from the wrong customer (cash allocations, then points earned from it),
- records the payment on the right customer,
- allocates it there by cash priority (ACC-003).

## 4. Open questions at this stage

These are the things I could not yet answer from the rules. Draft 2 resolves them.

| #   | Question                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | How is a receipt "moved" without editing it? `payment_receipts.amount_paise` is checked `> 0` and receipts are never updated. Options: a transfer table, or signed receipts. |
| Q2  | How is a delivery "un-confirmed"? `deliveries.qty` is checked `> 0`. Same question.                                                                                      |
| Q3  | An action currently carries one `customerId`. FDSK-169 changes two customers. Where do versions, audit events and invariant reviews hook in?                           |
| Q4  | Which delivery confirmation is "wrong" when a line has several? Is that an ambiguity question to the user (rule 7.2 in the brief), or a default?                        |
| Q5  | Does cash released by FDSK-170 go back to open charges immediately? WF-002 lists the allocation occasions, and a correction is not one of them.                          |
| Q6  | What if the receipt already funds a credit note? CUS-001 says credit funding cannot cross customers.                                                                    |

## 5. Risks I expect

- Copy-pasting the settlement-release loop from `ReturnsService` into a second place.
- Forgetting a reaction (`allocateCash`, `refresh`) in a new handler. The review would catch it only at runtime.
- The `switch`, the role checks and the docs' role table drifting apart as actions are added.
