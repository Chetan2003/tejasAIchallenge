# Architecture draft 3: after building the plain version, and after research

**Status:** superseded by the [final architecture](04-final-architecture.md).
**Written by:** Claude (Sonnet 5.5), prompted by Chetan, 31 Oct 2026. Agent-written.
**Written after:** implementing both features in the existing style (git tag `solution-a-plain-services`) and three short web searches (links in section 3). Written before the framework refactor.

## 1. What the plain version taught me

Both stories work in the plain style: 17 scenario tests, one migration, 269 tests green. The cost is visible in the diff and not in the tests.

| Evidence from `solution-a-plain-services`                              | What it shows                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `git diff 63fbc8f..solution-a-plain-services -- server/src shared/src` | +619 / −179 lines across 16 files for two stories.                                                                                                                                                     |
| One new action touches 7 places                                        | shared zod schema, owning service method, `switch` arm in `ActionsService`, an `authorize(...)` line, the tail reaction calls, an audit-evidence string, the docs role table.                          |
| The same fact lives in several places                                  | A role set appears in code (once per service) and in `business_terms.md`. The allocation occasions of WF-002 exist only as copies of `allocateCash(); refresh();` at the end of six methods.           |
| Nothing stops omissions                                                | The `switch` is not exhaustive, so a command with no `case` compiles. `MOVE_CUSTOMER_PAYMENT` was only caught because I remembered. A forgotten reaction is caught only by a runtime invariant review. |
| One genuine generalisation was needed                                  | Two-customer actions. That had to change the engine (versions, audit events, review), not a service.                                                                                                   |
| The expensive logic was already shared                                 | The hard part, "shrink a charge and give back cash, then credit, then points", is now one function, `reduceCharge`, used by returns and FDSK-170. No framework was needed for that.                    |

So the combinatorial pressure is **not** in the money arithmetic. It is in the _wiring_: who may do what, what must run afterwards, and which customers an action touches. That wiring is policy, and it is currently scattered.

## 2. Options considered

| Option                                                             | Idea                                                                                                                            | Verdict                                                                                                                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Plain services (built)                                          | Another `case`, another method.                                                                                                 | Works; wiring keeps spreading. Kept as a baseline.                                                                                                                                      |
| B. General rules engine (Drools / RETE style)                      | Facts in working memory, `when … then` rules, engine decides what fires.                                                        | Rejected. Our rules are workflows with exact money arithmetic and fixed order, not independent decisions on facts. Firing order becomes implicit, which is the opposite of reviewable.  |
| C. Statechart per entity                                           | One machine each for Order, Shipment, Receipt, with guarded transitions.                                                        | Partly kept in spirit: states already exist as models (`OrderModel`, `ShipmentQuantity`). Cross-entity effects (cash, points) do not fit one machine, so I did not build a generic one. |
| D. Saga / choreography                                             | Modules emit events, others react, compensate on failure.                                                                       | Take the _events_ and the _compensating entries_. Skip the saga runner: one SQLite transaction already gives all-or-nothing, and a failed invariant rolls the whole action back.        |
| E. Event sourcing                                                  | Store events only; derive balances.                                                                                             | Rejected for scope. The ledgers are already append-only and signed. Derived views exist.                                                                                                |
| **F. Action catalog + domain events + shared primitives (chosen)** | Rules as data (who, why, what may follow), handlers as plain functions, one engine that enforces them, invariants as the judge. | Smallest thing that removes the scattering without hiding the arithmetic.                                                                                                               |

## 3. Research notes

Three searches, read quickly. What I took and what I did not.

1. **Rules engines.** Write-ups agree they pay off when rules change often, are owned by several teams, or need traceability, and that they add cost for ordinary CRUD-style workflows ([overview](https://geekchamp.com/?p=400833)). One also notes that execution order is driven by agenda and conflict resolution, so two readers can disagree about what fires first. Decision tables suit rules that fit a template plus data ([Credera](https://www.credera.com/insights/why-you-should-build-a-business-rules-engine-with-drools)). **Taken:** the table form for pure policy (roles, reaction occasions). **Left:** the engine.
2. **Sagas and compensation.** Compensation does not restore the exact earlier state; it reaches a state that is consistent from the business's point of view ([compensating transaction](https://en.wikipedia.org/wiki/Compensating_transaction)). A write-up on sagas points out that teams often adopt them after a service split they did not need, and that one shared database with ordinary transactions removes the need ([saga pattern](https://vercel.com/i/saga-pattern)). Another frames compensation as bookkeeping: offset, never delete ([compensating transactions](https://leanstudy.pages.dev/system-design/fundamentals/69-compensating-transactions)). **Taken:** compensating entries (already the house style: signed allocations, applications, adjustments). **Left:** a saga coordinator.
3. **Command registries and central authorization.** Replacing a large `match` with a registry of handlers is a known refactor ([example](https://docs.rs/crate/ccswarm/0.4.2/source/src/cli/command_registry.rs)). Scattered permission checks are described as "authorization in disguise" ([Checkpoint](https://checkpoint.readthedocs.io/en/stable/policies.html)), and centralising them keeps one policy owner ([DADL paper](https://arxiv.org/pdf/2605.05247)). **Taken:** a registry plus one authorization choke point.

I also asked myself the question the brief asks: is this worth it? A registry plus a catalog costs roughly 250 lines and removes the seven-place edit. It is not a general engine, and the [decision guide](../decision-guide.md) says when it stops being enough.

## 4. Decision

Build **F**, on top of what exists, without touching the money logic:

1. **Action catalog** (`server/src/rules/action-catalog.ts`): pure data. For every command: who may run it, one plain-English sentence, the canonical rules it implements, and which domain events it may emit. A `Record<CommandType, …>`, so a command without an entry does not compile.
2. **Domain events + reaction table** (`server/src/rules/`): handlers say _what happened_ (`DELIVERY_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_RELEASED`, …) for a named customer. A small table says what follows: WF-002 (which events allocate cash) and the reward rules (which events re-derive points). This replaces the copied tail calls, and it handles the two-customer case without special syntax: the moved payment emits one event per customer.
3. **Handler registry** (`server/src/actions/action-handlers.ts`): `{ [T in CommandType]: handler }`, exhaustive by type. `ActionsService` stops being a 300-line switch.
4. **One engine**: authorize from the catalog, run the handler, run reactions for every touched customer, bump versions, write audit events, run the invariant review on every touched customer. Undeclared events throw.
5. **Generated rule sheet** (`docs/rules-catalog.md`): rendered from the catalog; a test fails if the file or the business-terms role table drifts from it. This is what a non-technical reader opens.
6. **Invariants stay the judge**: the existing pre-commit review is the oracle. The framework does not try to prove rules; it tries to make them visible.

## 5. What I am deliberately not building

- A rule DSL, parser, or runtime-editable rules. Rules change with code review, not in production.
- A generic state machine or dependency-graph engine. See the [decision guide](../decision-guide.md) for the signal that would justify one.
- Preconditions as data. Guards such as "below returned units" stay as readable domain code next to the quantity models. Moving them into the catalog would trade clarity for cleverness.

## 6. Predictions to check afterwards

- Adding an action should need 3 edits (shared schema, catalog entry, handler), with the compiler pointing at the missing ones.
- No service should call `authorize` or `allocateCash`/`refresh` any more.
- Behaviour must not change: all 269 tests stay green with no test edits except for the new rule-sheet test.
