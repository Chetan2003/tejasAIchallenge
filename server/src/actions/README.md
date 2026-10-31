# Actions

Owns the command execution boundary and persisted idempotency outcomes for CRM activities.

## Implementation

- [actions.model.ts](actions.model.ts): The `action_requests` table, including requester-scoped keys and stored results.
- [actions.repository.ts](actions.repository.ts): Request lookup, action lookup, and result persistence.
- [actions.service.ts](actions.service.ts): Actor verification, request fingerprints, version checks, role check from the rule catalog, handler dispatch, reactions for every affected customer, aggregate versions, audit events, and commit coordination.
- [action-handlers.ts](action-handlers.ts): The exhaustive `{ command: handler }` map to domain services. Pure wiring; a command without a handler does not compile.
- [actions.controller.ts](actions.controller.ts): Validation and authenticated handling of `POST /api/crm/actions`.

## Coordination

Execution uses an immediate SQLite transaction with a nested savepoint. A rejected operation rolls back business writes while its request outcome can still be stored. An action may change several customers (a moved payment changes two): every customer a handler names through `emit` is versioned, receives an audit event, and passes Audit checks before commit. Who may run an action and what follows an event come from the [rules](../rules/README.md) module. Domain services own the actual order, fulfillment, finance, and reward operations. Browser clients, CLI seeding, and integration fixtures submit commands through this boundary.

## Related

- [Backend module index](../README.md)
