import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderRuleSheet } from '../rules/render-catalog.js';

/** Regenerates docs/rules-catalog.md from the action catalog. Run with `pnpm rules:doc`. */
const target = fileURLToPath(
  new URL('../../../docs/rules-catalog.md', import.meta.url),
);
writeFileSync(target, renderRuleSheet());
console.log(`Wrote ${target}`);
