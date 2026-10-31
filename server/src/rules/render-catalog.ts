import { ACTIONS, REACTIONS, REACTION_ORDER } from './action-catalog.js';
import { DOMAIN_EVENTS } from './domain-events.js';
import type { Role } from '@crm/shared';

const ROLE_NAMES: Record<Role, string> = {
  ADMIN: 'Admin',
  SALES: 'Sales',
  KAM: 'KAM',
  WAREHOUSE: 'Warehouse',
  ACCOUNTS: 'Accounts',
};

/** Display name for a role, as used in the business-terms action table. */
export const roleName = (role: Role) => ROLE_NAMES[role];

/**
 * The rule sheet a non-technical reader opens. Generated from the catalog,
 * never edited by hand: `rules-catalog.test.ts` fails if the checked-in file
 * differs from this output.
 */
export function renderRuleSheet(): string {
  const rows = Object.entries(ACTIONS).map(([type, rule]) => {
    const then = rule.emits
      .map((event) => {
        const follows = REACTION_ORDER.filter((name) =>
          (REACTIONS[name].after as readonly string[]).includes(event),
        );
        return `After ${DOMAIN_EVENTS[event]}: ${
          follows.length
            ? follows.map((name) => REACTIONS[name].does).join('; then ')
            : 'nothing further'
        }.`;
      })
      .join('<br>');
    return `| \`${type}\` | ${rule.roles.map(roleName).join(', ')} | ${rule.summary} | ${rule.rules.join(', ') || '—'} | ${then || '—'} |`;
  });
  return `# Rule sheet

_Generated from \`server/src/rules/action-catalog.ts\` by \`pnpm rules:doc\`. Do not edit by hand; a test fails if this file and the catalog disagree._

Admin may run every action below. Each action runs inside one transaction. After it, the system checks every account it touched (quantities, money, credit, points) and refuses to commit if any check fails.

## Actions

| Action | Who (besides Admin) | What it does | Canonical rules | What happens afterwards |
| ------ | ------------------- | ------------ | --------------- | ----------------------- |
${rows.join('\n')}

## What follows what

Cash is allocated before points are recomputed, for each affected customer. Rules: ${REACTION_ORDER.map((name) => `**${REACTIONS[name].rule}**`).join(', ')}.

| Event | Allocates free cash (WF-002) | Recomputes points (REW-001..003) |
| ----- | :--------------------------: | :------------------------------: |
${(Object.keys(DOMAIN_EVENTS) as Array<keyof typeof DOMAIN_EVENTS>)
  .map((event) => {
    const has = (name: keyof typeof REACTIONS) =>
      (REACTIONS[name].after as readonly string[]).includes(event)
        ? 'yes'
        : '—';
    return `| ${DOMAIN_EVENTS[event]} | ${has('allocateCash')} | ${has('refreshRewards')} |`;
  })
  .join('\n')}
`;
}
