# Evaluator notes

Submission for the Tejas AI Engineering take-home: **Business Rules Engine** (FDSK-169, FDSK-170).

## Read in this order (about 15 minutes)

1. [Final architecture](docs/architecture-evolution/04-final-architecture.md), then skim drafts [1](docs/architecture-evolution/01-first-draft.md), [2](docs/architecture-evolution/02-refined-draft.md), [3](docs/architecture-evolution/03-post-research-draft.md) to see how the design moved.
2. [Rule sheet](docs/rules-catalog.md). Generated from code. Read it as a non-engineer would: who may do what, which canonical rule it implements, what happens afterwards.
3. The engine and its data: [`server/src/rules/action-catalog.ts`](server/src/rules/action-catalog.ts), [`server/src/actions/actions.service.ts`](server/src/actions/actions.service.ts), [`server/src/actions/action-handlers.ts`](server/src/actions/action-handlers.ts).
4. FDSK-170: `FulfillmentService.correctDelivery` and [`delivery-correction.test.ts`](server/test/delivery-correction.test.ts).
5. FDSK-169: `AccountsService.moveReceipt` and [`receipt-move.test.ts`](server/test/receipt-move.test.ts).
6. [Decision guide](docs/decision-guide.md) and [two solutions compared](docs/solutions-comparison.md).

`git log --reverse 63fbc8f..HEAD` tells the story. The first two commits after the upstream history are architecture drafts, written before any code; draft 3 sits between the plain solution and the framework; the final architecture is committed last.

## Deliverables map

| #   | Deliverable                                         | Where                                                                                                                                                                                       |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sample app with changes, upstream history kept      | This repository. Upstream commits are intact (`63fbc8f` and earlier). Not a fork.                                                                                                           |
| 2   | Bonus: two solutions, different trade-offs          | Git tag `solution-a-plain-services` (plain services) and `main` (rule catalog). [Comparison](docs/solutions-comparison.md).                                                                 |
| 3   | Decision tree and evaluation metrics                | [docs/decision-guide.md](docs/decision-guide.md)                                                                                                                                            |
| 4   | Architecture given to the agent, with its evolution | [CLAUDE.md](CLAUDE.md) (the briefing), [`.claude/commands/add-action.md`](.claude/commands/add-action.md), and `docs/architecture-evolution/01..04`. Each stage was committed when written. |
| 5   | Chat history with the coding agent                  | [docs/agent-chat/](docs/agent-chat/README.md). **To be exported by Chetan before submission.**                                                                                              |
| 6   | Git history                                         | Not squashed. Small steps, messages say what and why. Plain solution tagged.                                                                                                                |
| 7   | This file                                           | Time spent is below.                                                                                                                                                                        |

## Who did what, honestly

- **The architecture drafts, the code, the tests and these notes were written by Claude (Sonnet 5.5)** working with Chetan. Chetan chose the shape ("middle ground plus a plain baseline"), chose to deliver by git bundle, and delegated the remaining design decisions to the agent. He did not supply a first draft, so draft 1 is the agent's, and says so at the top. If Chetan's own thinking differs, it belongs in the section at the end of this file.
- **"Research" was three short web searches** (rules engines, sagas and compensation, command registries). Links are in draft 3. It was enough to choose between options, not a literature review.
- The commits carry a `Co-Authored-By` trailer for this reason.

## What to check, and what I am less sure about

- **Behavioural choices made from the rules, stated where they live.** WF-002 does not list corrections as an allocation occasion, so cash released by FDSK-170 stays free until the next occasion. A receipt that ever funded a credit note cannot be moved. A moved receipt takes the time of the move for cash priority. All are in [final architecture §9](docs/architecture-evolution/04-final-architecture.md#9-limitations-stated-plainly); each is a one-line change in `REACTIONS` or a guard, if a stakeholder disagrees.
- **The framework does not shrink the code.** B has 271 more source lines than A and about the same number of branches. It moves wiring into one place and adds compile-time and test guards. [The comparison](docs/solutions-comparison.md) says so; the decision guide builds on it.
- **Preconditions are not in the catalog.** Deliberate. See the guide, "Signals that you adopted too much".
- **UI is small and in the existing style.** `activity-dialog.tsx` is still one component with per-type branches. I did not refactor it.
- **Version string.** `termsVersion` is still `2026-10-26.1` because existing tests pin it. The version table in `docs/business-terms.md` records that ACC-004 and WF-006 were added after it.
- **Not tested:** production-scale data, concurrent moves of the same receipt beyond what SQLite's immediate transaction gives, browsers other than Chromium, mobile layouts.

## Verification

```sh
pnpm check     # lint, typecheck, tests, build
```

- 276 tests pass: the 251 that came with the repo (unedited), plus 17 scenario tests for the two features, 1 migration test, and 7 for the rule catalog and its drift checks.
- Lint, type-check and the production build pass. Formatting is Prettier-clean.
- UI: driven end to end with Playwright on the seeded dataset (screenshots in [docs/screenshots](docs/screenshots)): Oakwood's 10-unit line corrected to 6 and its payment moved to Greenfield, with "27 of 27" balance checks passing. The seeded Greenfield payment funds a credit note, so moving it is refused; that screenshot is kept too.

## AI workflows

- [`CLAUDE.md`](CLAUDE.md) is the standing briefing: architecture rules, commands, conventions, commit style.
- [`/add-action`](.claude/commands/add-action.md) is the three-edit recipe for a new action. The framework is what makes it short: the compiler flags the missing catalog entry or handler.
- `pnpm rules:doc` plus a drift test keep the readable rule sheet equal to the code, so the document a reviewer reads cannot lie.
- `ServiceDesk` (`server/test/support/service-desk.ts`) is the shared scenario harness, so agent-written tests read as business stories with exact numbers.
- Migration warning in `CLAUDE.md`: `drizzle-kit` once emitted a wrong table-rebuild `INSERT` for a new column. A migration test now upgrades populated data.

## Time spent

**Agent session, from the repository's own timestamps** (first user message 17:19 IST; times are approximate and the phases overlap):

| Phase                                                                  | Time (IST)    | About        |
| ---------------------------------------------------------------------- | ------------- | ------------ |
| Reading: brief, canonical rules, services, baseline test run           | 17:19 – 17:27 | 8 min        |
| Planning: drafts 1 and 2, extract `reduceCharge`                       | 17:27 – 17:31 | 4 min        |
| Coding, plain solution: schema, FDSK-170, FDSK-169, tests              | 17:31 – 17:42 | 11 min       |
| Research and draft 3                                                   | 17:42 – 17:44 | 2 min        |
| Coding, framework: catalog, events, engine, rule sheet, canonical docs | 17:44 – 17:51 | 7 min        |
| UI and browser check                                                   | 17:51 – 18:05 | about 14 min |
| Final docs, notes, full check, bundle                                  | 18:05 – 18:30 | about 25 min |

The session is the agent's wall-clock, not a measure of how long this would take a person.

**Chetan's own time:** _fill in: reading the brief, conversation with the agent, reviewing the diff, exporting the chat, pushing and inviting collaborators._

## Chetan's own notes

_Add anything you would say differently, any decision you disagree with, and what you learned._
