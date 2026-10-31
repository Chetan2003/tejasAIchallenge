# Rules

Owns the business rules about actions, kept as data: who may run each command, what it is for, which canonical rules it implements, which events it may report, and what follows each event. It holds no database access and no domain arithmetic.

## Implementation

- [action-catalog.ts](action-catalog.ts): `ACTIONS`, one `ActionRule` per command (typed `Record<CommandType, …>`, so a missing entry does not compile), and `REACTIONS`, the table of which events allocate cash (the WF-002 occasions) and which recompute points.
- [domain-events.ts](domain-events.ts): The events a handler may report, each with the plain phrase used in the rule sheet.
- [render-catalog.ts](render-catalog.ts): Renders the catalog as `docs/rules-catalog.md`, the sheet a non-technical reader opens.

## Coordination

`ActionsService` reads the catalog: it authorizes from `roles`, lets only declared `emits` through (`emit` throws otherwise), and runs the reactions in `REACTIONS` for every customer an event names. Domain services never check roles and never call the reactions; they report what happened. `pnpm rules:doc` regenerates the sheet, and `server/test/rules-catalog.test.ts` fails if the sheet, the business-terms role table, or the command list drifts from the catalog.

Detailed conditions (quantity bounds, charge limits) stay in the domain models next to the data they guard. See the [decision guide](../../../docs/decision-guide.md) for why rules are not a general engine.

## Related

- [Backend module index](../README.md)
- [Rule sheet](../../../docs/rules-catalog.md)
- [Final architecture](../../../docs/architecture-evolution/04-final-architecture.md)
