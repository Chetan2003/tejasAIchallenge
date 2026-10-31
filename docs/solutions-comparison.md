# Two solutions, two trade-offs

The brief asks for two solutions that trade framework code against workflow complexity. Both implement FDSK-169 and FDSK-170 completely. Both pass the same tests. They differ in where the _wiring_ lives.

|                                            | **Solution A: plain services**                                                                                                  | **Solution B: rule catalog (this repo's `main`)**                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Where                                      | git tag `solution-a-plain-services` (commit `41909fe`)                                                                          | `main`                                                                                                             |
| Idea                                       | Add each command the way the repo already does: a `case`, a service method, an `authorize` line, the reaction calls at the end. | Keep the same domain code. Move who/what-follows/which-customers into data (`rules/`), one engine enforces it.     |
| Framework code                             | almost none (a few dozen lines in the engine so an action can touch two customers)                                              | about 270 net lines more than A (`rules/` 270 and `action-handlers.ts` 54, less what left the engine and services) |
| Feature code (both stories)                | the +436 net lines over baseline are almost all feature code, shared primitives and tests excluded                              | the same feature code, unchanged                                                                                   |
| `server/src` + `shared/src` nonblank lines | 7,774 (baseline 7,338)                                                                                                          | 8,045                                                                                                              |
| Branch proxy (decision nodes)              | 469 (baseline 430)                                                                                                              | 457                                                                                                                |
| Edits to add one action                    | 7 places: schema, service method, `switch` arm, `authorize`, reaction tail, audit text, docs role table                         | 3 places: schema, catalog entry, handler. Docs table is generated, audit text is optional                          |
| Role rules live in                         | every service (`authorize` calls), plus the docs table                                                                          | `ACTIONS[*].roles`, one `authorize` call; a test compares them with the docs table                                 |
| WF-002 (when cash is allocated) lives in   | copies of `allocateCash(); refresh();` at the end of six methods                                                                | `REACTIONS.allocateCash.after`, five events, matching the rule text                                                |
| Two-customer action                        | works, but the author must remember to call the reactions for each customer                                                     | handler names the customers with `emit`; the engine reacts per customer                                            |
| Forgetting a piece                         | compiles; caught only by a runtime review                                                                                       | missing catalog entry or handler fails to compile; undeclared event throws                                         |
| Reading the rules                          | read seven files                                                                                                                | open `docs/rules-catalog.md` (generated)                                                                           |
| Tests                                      | 269                                                                                                                             | 276 (7 added for the catalog and drift)                                                                            |

## How to reproduce the numbers

```sh
git diff --shortstat 63fbc8f solution-a-plain-services -- server/src shared/src   # A vs baseline: +619 / −179
git diff --shortstat solution-a-plain-services main      -- server/src shared/src   # B vs A:        +424 / −138
git checkout solution-a-plain-services && pnpm metrics                              # nonblank lines, decision nodes
```

Line counts in the table are nonblank TypeScript from `scripts/source-metrics.mjs`, restricted to `server/src` and `shared/src`. The metric is the repo's own, with its caveat that decision nodes are a branch proxy and not a measure of review effort.

## What the numbers say, honestly

- **B is bigger than A.** Today the framework does not save lines, and at 22 actions it barely changes the branch count. The gain is not size. It is that three facts (who, what follows, which customers) stop being copied into every action.
- **The money logic is identical.** `reduceCharge`, `receiptBalance`, signed entries and the invariant review are in both. Neither solution reduces the work of getting the arithmetic right.
- **A's weak spot is omission, not volume.** Nothing forced the new `MOVE_CUSTOMER_PAYMENT` to appear in the `switch`; it compiled without it. B makes that a compile error.
- **B's weak spot is indirection.** To see what an action really does you read the catalog, then the handler, then the service. For 22 actions that is fine; the [decision guide](decision-guide.md) says when it stops being fine.

## When to prefer each

Prefer **A** when the action count is small and stable, one or two people own the code, and rules are rarely reviewed by non-engineers. Prefer **B** when actions keep arriving, several people or agents add them, the same permission and follow-up facts keep being copied, a stakeholder wants to read or sign off the rules, or an action can touch more than one aggregate. Neither is "the right answer"; the [decision guide](decision-guide.md) turns this into questions and thresholds.
