import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { markFailure, measureOf } from '@repo/journeys/testing/measure';

/**
 * The accessibility check of web journeys. A journey calls
 * `accessible(page, 'where')` after each step that renders a page, and
 * `outcome()` calls it after each outcome holds. It runs axe on the whole page
 * and fails on any violation, `minor` included, because a journey has no
 * accessibility error. It has no way to skip a rule: fix the defect. It keeps
 * each result in the measures of the run. A failure there fails the run. See
 * https://github.com/eggdev/clutch/blob/main/docs/contributing/capabilities/a11y-checks.md.
 */

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

/** Fails the journey when axe finds any violation on the page, and attaches its report. */
export async function accessible(page: Page, where: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const measure = measureOf(page);
  measure?.axe.push({
    where,
    elapsedMs: Date.now() - measure.startedAt,
    violations: result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      nodes: violation.nodes.length,
    })),
  });
  const failing = result.violations;
  if (failing.length > 0) {
    if (measure) {
      markFailure(
        measure,
        'axe',
        `axe found violations at "${where}": ${describe(failing).join('; ')}`,
      );
    }
    await test.info().attach(`axe ${where}`, {
      body: JSON.stringify(failing, null, 2),
      contentType: 'application/json',
    });
  }
  expect(describe(failing), `axe found violations at "${where}"`).toEqual([]);
}
