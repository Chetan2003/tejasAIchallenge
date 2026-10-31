---
description: Add a new business action (command) to FieldDesk in three edits, with tests and docs
argument-hint: <ACTION_NAME> <who may run it> <one-line purpose>
---

Add the action `$ARGUMENTS` to FieldDesk. Read `CLAUDE.md` first, then the canonical rule ids the action touches in `docs/candidate-walkthrough/canonical_business_rules.md`.

1. **Rules first.** If behaviour is not in the canonical rules, add a rule (next free id in the module) in the same style and say it is an assumption. Prefer deriving behaviour from existing rules.
2. **Contract.** Add the zod schema in `shared/src/crm.ts` with `action('NAME', { ... })`. Build shared: `pnpm --filter @crm/shared build`.
3. **Catalog.** Add the entry to `ACTIONS` in `server/src/rules/action-catalog.ts`: roles, plain sentence, rule ids, and the events it may emit. If it needs a new event, add it to `DOMAIN_EVENTS` and to the right lists in `REACTIONS` (state which WF-002 / REW rule justifies each).
4. **Handler.** Add one line to `handlersFor` in `server/src/actions/action-handlers.ts`. The compiler must now be happy.
5. **Domain method.** Put it in the owning service. No role check. Writes go through repositories as new rows, never edits. Reuse `reduceCharge`, `receiptBalance`. Call `emit(c, EVENT, customerId)` for what happened, naming every customer whose books change. Throw `DomainDecision` instead of guessing when intent is ambiguous.
6. **Tests.** Scenario tests with `ServiceDesk`: the happy path with exact numbers, each refusal with its error code, a role check, and `assertConsistent` for every affected customer.
7. **Docs.** Add the row to the action table in `docs/candidate-walkthrough/business_terms.md`, describe the request in `docs/api.md`, run `pnpm rules:doc`.
8. **Verify and commit.** `pnpm check`. Commit in small steps with messages that say why.

Report: which rules you derived from, which you assumed, and any limitation.
