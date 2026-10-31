# Claude Code prompts

Two prompts. Use **Prompt A** to build the solution yourself in a fresh clone (this is the one whose transcript becomes your chat history). Use **Prompt B** on the repository that came with this submission, to review it, make it yours and finish the deliverables that only you can do.

Both assume Claude Code is started in the repository root. Keep the repository **private**. Do not fork the upstream repo.

---

## Prompt A: build it from a fresh clone

```text
You are working in a private clone of github.com/AviKKi/field-desk (NestJS + Drizzle + SQLite API, React client, zod contracts in `shared`). Complete the Tejas "Business Rules Engine" take-home. Read, in this order: docs/candidate-walkthrough/README.md, business_terms.md, canonical_business_rules.md; then server/src/actions/actions.service.ts, accounts/accounts.service.ts, fulfillment/fulfillment.service.ts, returns/returns.service.ts, rewards/rewards.service.ts, audit/audit.service.ts. Run `pnpm install && pnpm test` first and record the baseline (251 tests).

## Goal
1. Implement FDSK-169 (move a payment recorded against the wrong customer) and FDSK-170 (correct an overstated delivery) so both obey the canonical rules.
2. Put the business rules about actions in one reviewable, non-technical-readable place instead of scattering them. Middle ground: not a general rules engine.
3. Produce the deliverables: architecture documents in four committed stages, a decision guide, a two-solution comparison, Evaluator_notes.md, and a commit history that tells the story.

## Ground rules
- Commit in small logical steps (one rule, refactor or feature slice each). Messages say what and why. Never squash or rewrite history. Commit each architecture document the moment you write it.
- Architecture docs go in docs/architecture-evolution/: 01-first-draft.md (before any code), 02-refined-draft.md, 03-post-research-draft.md (after you have built the plain version AND done a few real web searches on rules engines, sagas/compensation, command registries), 04-final-architecture.md. Label them honestly as agent-written. Do not backfill earlier drafts.
- History is append-only (WF-001): never UPDATE or DELETE posted rows; correct with new signed, linked rows. Money is integer paise.
- Do not edit existing tests to make new behaviour pass. Do not move preconditions into data.
- Every change must pass `pnpm check`. The pre-commit invariant review (`AuditService.review`) is the oracle.
- Use a TaskCreate task list. Ask me only if a decision is expensive to reverse and the rules do not settle it.

## Decisions already made (do not reopen; explain deviations)
Representation
- A receipt is never edited. A move is a new table `receipt_moves(id, receipt_id, to_receipt_id, from_customer_id, to_customer_id, amount_paise>0, reason, action_id, created_at)` that consumes the receipt's value, plus a new receipt on the right customer with the same amount and bank reference. ACC-002 becomes u = m − a − f − t ≥ 0.
- A delivery correction is a signed `deliveries` row (qty < 0, with new column `reverses_delivery_id`) and exactly one negative receivable entry of kind `DELIVERY_CORRECTION` (adjusts_id = the confirmation's charge, source_id = the correction). Change the qty check to `qty > 0 OR (qty < 0 AND reverses_delivery_id IS NOT NULL)`. Generate the migration with `pnpm db:generate` and READ it: drizzle-kit may list the new column in the INSERT…SELECT of the table rebuild, which the old table lacks. Fix by hand and add a migration test that upgrades populated data.
Behaviour
- FDSK-170 (role KAM, Admin): payload `{ orderId, shipmentId, reason, items:[{ shipmentLineId, deliveredQty, confirmationId? }] }`. `deliveredQty` is the corrected TOTAL. Require returned ≤ new < current. Pick the confirmation: if exactly one has correctable units use it; if several and none named, throw `DomainDecision` (ask, never guess). Correctable = min(units standing, units its charge still carries), because returns consume the oldest charges first. Reduce the charge and give back over-settlement exactly as WF-003 does (cash, then credit, then points, each to its source). Reopen a DELIVERED shipment as DISPATCHED when units are undelivered. Do NOT re-allocate cash (WF-002 does not list corrections). Points are re-derived by the existing refresh.
- FDSK-169 (role Accounts, Admin): payload `{ customerId, receiptId, toCustomerId, reason }`; version of the customer moved FROM. Whole receipt only. Refuse: not that customer's receipt, same customer, already moved, or funds a credit note (CRD-006 keeps funding reserved forever). Release the receipt's cash from the wrong customer's charges with negative allocations; create the new receipt on the right customer; allocate there by ACC-003 (it is a payment receipt); recompute points on both (spent points become clawback pending, REW-003).
Structure
- Extract the shared logic first: `AccountsService.reduceCharge(c, charge, reduction, {kind, sourceId})` out of ReturnsService (behaviour unchanged, tests green), and `ReceiptBalance` / `AccountsService.receiptBalance` as the single definition of free cash (it was computed four times).
- Make `allocateCash` and `rewards.refresh` take an explicit customerId.
- Add `ActionContext.customerIds` (set) so one action can change two customers. The engine bumps versions, writes an audit event and runs the invariant review for EVERY affected customer.

## Work plan (commit order)
1. docs: draft 1 (what you think after reading, open questions). docs: draft 2 (answers, data model, sub-problems).
2. refactor: extract reduceCharge (tests green). feat(schema): migration + models. refactor: explicit-customer reactions + receiptBalance.
3. feat: CORRECT_DELIVERY, plain style (switch case, service method, authorize, tail reaction calls) + tests. feat: MOVE_CUSTOMER_PAYMENT, plain style + engine multi-customer support + tests. Tag `solution-a-plain-services`. Measure: `pnpm metrics`, and count the places one action touches.
4. Research (real searches), then docs: draft 3 (what the plain version showed, options considered, decision, what you will NOT build, predictions to check).
5. Framework, Solution B, existing tests untouched:
   - `server/src/rules/action-catalog.ts`: `ACTIONS: Record<CommandType, ActionRule>` (roles, one plain sentence, canonical rule ids, `emits`), and `REACTIONS` (events that allocate cash = exactly the WF-002 occasions; events that recompute points).
   - `server/src/rules/domain-events.ts`; `emit(c, EVENT, customerId?)` in common/domain.ts throws on an undeclared event and marks the customer affected.
   - `server/src/actions/action-handlers.ts`: `{ [T in CommandType]: handler }`, exhaustive by type.
   - `ActionsService`: authorize from the catalog (the ONLY authorize call), run handler, react per customer (the ONLY reaction call sites), then version/audit/review for every affected customer. Remove authorize and tail reaction calls from services; they emit events instead.
   - `render-catalog.ts` + `pnpm rules:doc` → docs/rules-catalog.md (exclude it from prettier). Tests: catalog covers every command; checked-in sheet equals generated; business_terms.md role table equals the catalog; every event is emitted by some action; undeclared event throws.
6. docs: add ACC-004 and WF-006 to canonical rules (extend ACC-002, WF-002, WF-005, FUL-006); add both actions to business_terms.md and api.md.
7. feat(client): a "Move to another customer" action on each payment (show Moved to / Moved from), and "Correct delivered quantity" on dispatched/delivered shipments for KAM/Admin, with an in-place selector when the system asks which confirmation was overstated (give useCommand an `onDecision` callback). Verify with Playwright on `pnpm db:seed` data and keep screenshots.
8. docs: 04-final-architecture.md (as built; limitations stated plainly; check draft 3's predictions against what happened, including bad news), decision-guide.md (decision tree + scorecard + when NOT to build a framework), solutions-comparison.md (measured, reproducible numbers), CLAUDE.md (this architecture as an agent briefing), `.claude/commands/add-action.md`, Evaluator_notes.md (honest about who wrote what, time spent, limitations).

## Acceptance (exact numbers; sku-a = 10000 paise a unit, 1000 points a unit)
FDSK-170: order of 10, all dispatched and confirmed, charge 100000 fully paid (points available 10000). Correct to 6 → charge remaining 60000, unapplied cash 40000, points {locked 4000, available 6000}, shipment DISPATCHED. Confirm the last 4 → unapplied 0, points available 10000. Two confirmations (4 then 6), correct to 7 with no confirmationId → NEEDS_DECISION with 2 options and nothing written; answering with the newer confirmation → charges [40000, 30000]. After returning 4 units: correct to 3 → BELOW_RETURNED; to 4 → ok, charge 0. Role WAREHOUSE → FORBIDDEN. Credit applied (30000) then correct 10→2 → credit available 10000 again. Spent points (8000 redeemed) → clawbackPending 2000.
FDSK-169: two customers, each with a delivered 100000 charge. Northside paid 100000 (bank ref UTR-GREENFIELD). Move to Greenfield → Northside outstanding 100000, received 0, points {locked 10000, available 0}; Greenfield cash 100000, outstanding 0, points available 10000; original receipt still in Northside's ledger with a receipt_moves row; allocations show +100000 then −100000. Both reviews pass, both versions bump, both timelines show the event. Moving the same receipt again → RECEIPT_ALREADY_MOVED; moving the new receipt on to a third customer works. Credit-funded receipt → RECEIPT_CREDIT_FUNDED, nothing written.

## Definition of done
`pnpm check` green; existing 251 tests unedited and green; one `authorize` call site and one reaction call site; `git log` reads as a story; docs/rules-catalog.md matches the catalog; Evaluator_notes.md says plainly what is agent-written and what is unverified. Do not push anywhere; I will push to my private repo myself.
```

---

## Prompt B: review and finish the delivered repository

```text
You are in the repository delivered for the Tejas Business Rules Engine take-home (FDSK-169, FDSK-170). I will submit it, so I must understand and be able to defend every part of it.

1. Read CLAUDE.md, then docs/architecture-evolution/04-final-architecture.md, docs/decision-guide.md and docs/solutions-comparison.md. Then read server/src/rules/action-catalog.ts, server/src/actions/actions.service.ts, action-handlers.ts, `FulfillmentService.correctDelivery` and `AccountsService.moveReceipt`.
2. Run `pnpm install && pnpm check`. Report the test count and anything that fails. Do not change code to hide a failure.
3. Explain to me, in plain language and without jargon, how each feature works and why each choice was made, one at a time, and quiz me with three questions per feature that an interviewer might ask. Wait for my answers.
4. Review adversarially and report, ranked: wrong behaviour against the canonical rules (docs/candidate-walkthrough), missing tests, any place the framework hides logic, and any claim in the docs that the code does not support. Propose fixes as separate small commits; do not make them until I approve.
5. Help me finish what only I can: (a) put my own first thoughts into docs/architecture-evolution/ as a clearly labelled note, (b) fill in my time and my notes in Evaluator_notes.md, (c) export the chat history into docs/agent-chat/. Keep history intact: no squashing, no rewriting.
6. Then give me the exact commands to create a NEW PRIVATE GitHub repository, push all branches, tags and history, and add atul@patcorn.in, srijan_sahay@patcorn.in and prince@patcorn.in as collaborators. Remind me never to make the repository public.
```
