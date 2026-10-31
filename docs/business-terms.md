# Business reference

The CRM uses operating conventions version **2026-10-26.1**. The business guide is the source for the vocabulary and canonical behavior:

- [Business terms](candidate-walkthrough/business_terms.md): entities, states, roles, and actions.
- [Canonical business rules](candidate-walkthrough/canonical_business_rules.md): module invariants, domain policies, transitions, and intermodule workflows, with equations and SVG diagrams.
- [API reference](api.md#activities): request validation, retries, versions, and execution outcomes.

## Permissions

See [Roles and actions](candidate-walkthrough/business_terms.md#roles-and-actions). This includes the Admin override, acting staff selection, read access, and direct Warehouse return recording.

## Settlement corrections

See [Credits](candidate-walkthrough/canonical_business_rules.md#credits), especially CRD-005 and CRD-006, for settlement reversals. See WF-004 in [Intermodule and workflow logic](candidate-walkthrough/canonical_business_rules.md#intermodule-and-workflow-logic) for additional dispatched goods.

## Balance checks

See [Account reconciliation](verification.md#account-reconciliation) for the derived balance check. Activity results preserve the terms version used for the request; an exact retry preserves the original outcome.

## Version history

| Version                     | Effective date | Scope                                                                                                                                                                                                                           |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-26.1                | 2026-10-26     | Operating conventions for customer records, orders, fulfillment, settlement, and rewards.                                                                                                                                       |
| 2026-10-26.1 + FDSK-169/170 | 2026-10-31     | Adds **ACC-004** (receipt move) and **WF-006** (delivery correction); extends ACC-002, WF-002, WF-005 and FUL-006. The version string in code is unchanged on purpose: existing tests pin it, and these rules only add actions. |

## Related

- [Documentation index](README.md)
- [Business guide](candidate-walkthrough/README.md)
- [Business terms](candidate-walkthrough/business_terms.md)
- [Canonical business rules](candidate-walkthrough/canonical_business_rules.md)
- [Operations desk](operations.md)
- [API reference](api.md)
- [Verification](verification.md)
