# API reference

All routes use `/api`. Body-bearing writes accept JSON. Authentication uses the `crm_session` HttpOnly cookie. Browser writes need the configured Origin; command-line clients may omit Origin.

## Authentication and staff

| Method | Route                 | Access                                 |
| ------ | --------------------- | -------------------------------------- |
| GET    | `/health`             | Public                                 |
| POST   | `/auth/register`      | Public; creates a Sales account        |
| POST   | `/auth/login`         | Public                                 |
| GET    | `/auth/me`            | Signed in                              |
| POST   | `/auth/logout`        | Signed in; revokes the current session |
| GET    | `/users`              | Admin; paginated search                |
| POST   | `/users`              | Admin; create a staff account          |
| PATCH  | `/users/:id`          | Admin; change role or active status    |
| GET    | `/workspace/sales`    | Sales or Admin; workspace description  |
| GET    | `/workspace/accounts` | KAM or Admin; workspace description    |

Roles are `SALES`, `KAM`, `WAREHOUSE`, `ACCOUNTS`, and `ADMIN`. Public user fields are `{ id, name, email, role, active, createdAt }`. Registration accepts `{ name, email, password }`; login accepts `{ email, password }`. User creation also requires `role`. User updates accept `role` and/or `active` and revoke the target's sessions. Self-directed changes require another administrator.

`GET /users` accepts `search`, `page`, and `pageSize` (maximum 100), and returns `{ users, total, page, pageSize }`.

`GET /health` checks database access and returns `{ "status": "ok" }`. The workspace endpoints return `{ title, description, role }`; their access restrictions do not restrict the CRM read endpoints below.

## CRM reads and reference data

| Method | Route                         | Purpose                                                                |
| ------ | ----------------------------- | ---------------------------------------------------------------------- |
| GET    | `/crm/accounts`               | Customer account balance rows for the Accounts table                   |
| GET    | `/crm/bootstrap`              | Customers, catalog, orders, and available staff                        |
| GET    | `/crm/catalog`                | Product catalog                                                        |
| GET    | `/crm/orders`                 | Order rows with current totals and fulfillment progress                |
| GET    | `/crm/orders/:id`             | Order, lines, shipments, revisions, approvals, and timeline            |
| GET    | `/crm/orders/:id/shipments`   | Shipments with their line quantities                                   |
| GET    | `/crm/orders/:id/timeline`    | Order activity                                                         |
| GET    | `/crm/customers/:id`          | Customer identity and version                                          |
| GET    | `/crm/customers/:id/summary`  | Account position, charges, credits, and points                         |
| GET    | `/crm/customers/:id/ledger`   | Posting history and source documents                                   |
| GET    | `/crm/customers/:id/returns`  | Recorded physical returns                                              |
| GET    | `/crm/customers/:id/credits`  | Credit notes with available amounts                                    |
| GET    | `/crm/customers/:id/rewards`  | Point balances and reward postings                                     |
| GET    | `/crm/customers/:id/timeline` | All customer activities, including receipts and settlements            |
| GET    | `/crm/customers/:id/review`   | Versioned account consistency checks                                   |
| GET    | `/crm/customers/:id/snapshot` | Summary, orders, ledgers, timeline, and checks in one read transaction |
| GET    | `/crm/actions/:id/trace`      | Recorded action result; requester, actor, or Admin only                |
| POST   | `/crm/customers`              | Create `{ name, code }`; Sales, Accounts, or Admin                     |

All CRM reads require authentication and are available to every active role, except the action trace restriction shown above. Bootstrap returns `{ customers, skus, orders, actors }`; `actors` contains all active staff for an Admin and only the signed-in user for other roles. CRM list endpoints return arrays without server-side pagination; the client handles table search, filtering, and pagination.

The signed-in user's active role governs operations. Only an Admin may choose another active staff member through `actorId`; the submitted payload cannot grant that staff member a different role.

## Activities

Send `POST /crm/actions` with this envelope:

```json
{
  "command": {
    "type": "RECEIVE_CUSTOMER_PAYMENT",
    "payload": {
      "customerId": "customer-north",
      "amountPaise": 10000,
      "reference": "BANK-2026-01"
    }
  },
  "idempotencyKey": "a-unique-request-key",
  "expectedVersion": 0
}
```

Commands containing `orderId` use that order's version; commands containing `customerId` use the customer's version. `expectedVersion` is required except for `PUNCH_ORDER`; when supplied for a new order, it is checked against the customer. Every applied action advances the customer's version and the versions of **all that customer's orders**, including orders outside the action's payload. Use the returned `aggregateVersions` or refresh before the next action.

Request keys are scoped to the signed-in requester. Reuse the complete original envelope for a retry, including the acting staff member and expected version. A reused key with different input returns an idempotency conflict and preserves the original result. Rejected, version-conflicting, and unresolved request outcomes are also retained. After refreshing or supplying a requested decision, submit the changed input with a fresh key.

Supported types are `UPDATE_CUSTOMER`, `PUNCH_ORDER`, `EDIT_ORDER`, `SUBMIT_ORDER`, `APPROVE_ORDER`, `REJECT_ORDER`, `START_LOADING`, `DISPATCH_SHIPMENT`, `CONFIRM_DELIVERY`, `CANCEL_REMAINDER`, `RECORD_RETURN`, `RECEIVE_CUSTOMER_PAYMENT`, `ALLOCATE_PAYMENT`, `REDEEM_POINTS`, `ISSUE_CREDIT_NOTE`, `APPLY_CREDIT_NOTE`, `REFUND_CREDIT_NOTE`, `REVERSE_CREDIT_APPLICATION`, `REVERSE_CREDIT_REFUND`, `CORRECT_DISPATCHED_ORDER`, `CORRECT_DELIVERY`, and `MOVE_CUSTOMER_PAYMENT`.

The [rule sheet](rules-catalog.md) lists, for every type, who may run it, the canonical rules it implements, and what the system does afterwards. It is generated from the code.

`UPDATE_CUSTOMER` accepts `{ customerId, name, code }`, requires Sales, Accounts, or Admin, and uses the customer version. Customer codes remain unique and edits are recorded in activity history. Order rows in `/crm/bootstrap` include `totalPaise` for the current commercial revision and `fulfillmentStatus` derived from loading, dispatch, delivery, and cancellation quantities.

`CORRECT_DELIVERY` accepts `{ orderId, shipmentId, reason, items: [{ shipmentLineId, deliveredQty, confirmationId? }] }`, requires KAM or Admin, and uses the order version. `deliveredQty` is the corrected **total** delivered for that line; it must be below the current total and not below the returned units. When a line has several standing confirmations and `confirmationId` is omitted, the result is `NEEDS_DECISION` with one question per ambiguous line; answer by resubmitting with the chosen `confirmationId` and a fresh key.

`MOVE_CUSTOMER_PAYMENT` accepts `{ customerId, receiptId, toCustomerId, reason }`, requires Accounts or Admin, and uses the version of the customer the payment is moved **from**. The result's `aggregateVersions` includes both customers. A payment that funds a credit note is rejected with `RECEIPT_CREDIT_FUNDED`.

`CANCEL_REMAINDER` accepts optional `items: [{ lineKey, qty }]` to cancel selected unshipped quantities; omit `items` to cancel all eligible demand. An explicit empty list is rejected.

`REVERSE_CREDIT_APPLICATION` accepts `{ customerId, applicationId, amountPaise, reason }`. `REVERSE_CREDIT_REFUND` accepts `{ customerId, refundId, amountPaise, reason, reference }`. Both require Accounts or Admin, preserve original entries, append bounded negative entries, and use the customer version. A bank reference is required for refund reversal. See [business terms](business-terms.md) for amounts eligible for reversal.

The exact payload schemas and response types are exported by `@crm/shared/crm`. Unknown envelope and payload fields are rejected. Monetary fields are integer paise. Receipts accept a customer rather than an order identifier. A correction includes its reason, evidence, authorization reference, additional units, delivered quantities, and explicit physical dispatch details. See [permissions](business-terms.md#permissions) for the roles allowed to submit each operation.

Action responses contain `status`, `actionId`, `errors`, `decisions`, `effects`, `trace`, `aggregateVersions`, and document `references`. New results include `termsVersion` and, for applied activities, a `review` with `customerId`, `customerVersion`, `termsVersion`, `checkedAt`, and checks (`id`, `label`, `passed`, `details`, `references`). Each effect includes a reason, source reference, and provenance identifying its action, acting staff member, requester, and applicable commercial/shipment references. Older saved activities retain their original envelope without these newer optional fields. Status is `APPLIED`, `REJECTED`, `NEEDS_DECISION`, or `CONFLICT`. Domain outcomes use this envelope with HTTP 201, including domain rejections and version conflicts; inspect `status` rather than relying on HTTP success alone. Malformed requests return 400 and authentication or impersonation failures use 401/403. No domain records are committed on rejected or unresolved actions. The request outcome is retained for retries.

## Related

- [Business terms](candidate-walkthrough/business_terms.md)
- [Canonical business rules](candidate-walkthrough/canonical_business_rules.md)
- [Documentation index](README.md)
- [Operations desk](operations.md)
- [Business reference](business-terms.md)
- [Verification](verification.md)
- [Architecture](architecture.md)
- [Development setup](../CONTRIBUTING.md)
- [Backend module index](../server/src/README.md)
