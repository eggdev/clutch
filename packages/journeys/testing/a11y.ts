import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { measureOf } from '@repo/journeys/testing/measure';

/**
 * The accessibility check of web journeys. A journey calls
 * `accessible(page, 'where')` after each step that renders a page. It runs axe
 * on the whole page and fails on a `serious` or `critical` violation. It has
 * no way to skip a rule: fix the defect. It keeps each result, every impact
 * included, in the measures of the run. See
 * https://github.com/eggdev/clutch/blob/main/docs/contributing/capabilities/a11y-checks.md.
 */

/** The impacts that fail a journey. axe also reports `minor` and `moderate`. */
const failingImpacts = new Set(['serious', 'critical']);

type Violations = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'];

/** One line for each violation: the rule, what it means, the first nodes it hit and its page. */
function describe(violations: Violations) {
  return violations.map((violation) => {
    const nodes = violation.nodes
      .slice(0, 3)
      .map((node) => node.target.join(' '))
      .join(', ');
    return `${violation.impact} ${violation.id}: ${violation.help} (${nodes}) ${violation.helpUrl}`;
  });
}

/** Fails the journey when axe finds a serious or critical violation on the page, and attaches its report. */
export async function accessible(page: Page, where: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const measure = measureOf(page);
  measure?.axe.push({
    where,
    atMs: Date.now() - measure.startedAt,
    violations: result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      nodes: violation.nodes.length,
    })),
  });
  const failing = result.violations.filter((violation) =>
    failingImpacts.has(violation.impact ?? ''),
  );
  if (failing.length > 0) {
    await test.info().attach(`axe ${where}`, {
      body: JSON.stringify(failing, null, 2),
      contentType: 'application/json',
    });
  }
  expect(describe(failing), `axe found serious violations at "${where}"`).toEqual([]);
}
