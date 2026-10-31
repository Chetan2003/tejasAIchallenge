# Agent briefing: FieldDesk CRM

This is the technical architecture given to the coding agent. The long form, with its evolution, is in [docs/architecture-evolution](docs/architecture-evolution/04-final-architecture.md). Read that before changing behaviour.

## What this is

A pnpm workspace: `client` (React), `server` (NestJS, Drizzle, SQLite), `shared` (zod contracts). Customers, orders, fulfillment, returns, payments, credit and reward points. Business rules: `docs/candidate-walkthrough/canonical_business_rules.md` (ids like `ACC-004`, `WF-006`). Generated sheet of who-may-do-what: `docs/rules-catalog.md`.

## Commands

```sh
pnpm check            # lint, typecheck, tests, build: run before every commit
pnpm test             # shared build + server tests (about 2 minutes)
pnpm rules:doc        # regenerate docs/rules-catalog.md after editing the action catalog
pnpm db:generate      # after changing a Drizzle model; read the SQL it writes (see "Migrations")
pnpm format           # prettier
```

## Architecture rules (do not break)

1. **Every business change is a command** on `POST /api/crm/actions`, handled by `ActionsService`, in one SQLite transaction.
2. **Rules about actions live in `server/src/rules/action-catalog.ts`**: roles, one plain sentence, canonical rule ids, the events an action may emit, and the `REACTIONS` table (which events allocate cash, which recompute points).
3. **Services never check roles and never call `allocateCash` or `rewards.refresh`.** They write through repositories and call `emit(c, EVENT, customerId?)`. The engine authorizes and reacts. There is exactly one `authorize` call site and one reaction call site.
4. **A handler that changes another customer must name them** with `emit(c, EVENT, thatCustomerId)`. Only then are their versions bumped, audit event written and invariants reviewed.
5. **History is append-only (WF-001).** Never UPDATE or DELETE posted rows. Correct with a new signed row linked to the one it corrects (`adjusts_id`, `reverses_delivery_id`, `receipt_moves`).
6. **Money is integer paise. Quantities and points are integers.** Use `safe()` on sums.
7. **One definition per concept.** Free receipt cash: `AccountsService.receiptBalance`. Lowering a charge and giving back cash, credit, points: `AccountsService.reduceCharge`. Reuse, do not copy.
8. **The invariant review is the oracle** (`AuditService.review`). A new feature is done when it passes for every customer it touches, not when its own test passes.
9. **Preconditions stay readable code** in the domain models and services. Do not move them into the catalog or invent an expression language.
10. **Ambiguity is a question, not a default**: throw `DomainDecision` with options; the client resubmits with the answer.

## Add an action in three edits

Use `/add-action`. In short: a zod schema in `shared/src/crm.ts`, an entry in `ACTIONS`, a handler in `server/src/actions/action-handlers.ts`. The compiler flags a missing entry or handler. Then the domain method, tests, `pnpm rules:doc`, and a row in the business-terms action table (a test checks it).

## Tests

Scenario tests use `server/test/support/service-desk.ts` (`ServiceDesk`): a booted app on a throwaway database with helpers to create customers, orders, shipments and payments. Assert outcomes through `summary()` and `assertConsistent()`. Do not edit existing tests to make new behaviour pass; if a test must change, say why in the commit.

## Migrations

`drizzle-kit generate` has produced a wrong table-rebuild `INSERT` for a newly added column (it selects the new column from the old table). Read every generated migration. Add a migration test that upgrades populated data.

## Commits

Small, logical steps: one rule, one refactor, or one feature slice each. The message says what changed and why. Never squash or rewrite history. Commit architecture documents as they are written, not at the end. End commit messages with the attribution trailer the environment gives you.

## Do not

- Make the repository public. Do not fork the upstream repo.
- Hide behaviour in the framework: if reading a change needs more than the catalog, the handler and one service, the design has gone too far.
- Claim an action works until `pnpm check` and the invariant review pass.
