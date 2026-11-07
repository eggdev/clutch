import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { accessible } from '@repo/journeys/testing/a11y';
import { checkClickBudget, flush, measureOf } from '@repo/journeys/testing/measure';

/**
 * The outcome check of web journeys. A core journey asserts each outcome that
 * the catalog names through it, and nothing else:
 *
 * ```ts
 * const outcome = outcomes(page);
 * await outcome('signed-in', { url: '/home', text: 'Welcome' });
 * ```
 *
 * The name is the stable ID of the outcome. A PR that changes a journey
 * keeps each name, so a check can compare the outcomes of the two copies.
 *
 * Each outcome that holds is recorded twice: as a test annotation, and in the
 * measures of the run, with its time from the start of the test and the
 * clicks and keys so far. Then axe checks the page, so each state that a core
 * journey proves has no accessibility error. The journey runner
 * fails a core journey whose run did not record each outcome that the catalog
 * names. At the outcome where the click budget of a core journey ends, it
 * fails a run over the budget. So a journey takes `test` from
 * `@repo/journeys/testing/test`, which starts the measures. See
 * https://github.com/eggdev/clutch/blob/main/docs/contributing/journeys/core.md.
 */

/** What the page shows when the outcome holds: its path, a visible text, or both. */
export type Expected = { url: string; text?: string } | { url?: string; text: string };

/** An outcome name is kebab case, such as `signed-in` or `card-declined`. */
const namePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

/** Records an outcome that held, for the journey runner and for a later compare, then checks the click budget and runs axe. */
async function record(page: Page, name: string, expected: Expected) {
  const measure = measureOf(page);
  if (!measure) {
    throw new Error(
      "outcome() found no measures. Take `test` from '@repo/journeys/testing/test', not from '@playwright/test'.",
    );
  }
  const info = test.info();
  info.annotations.push({ type: 'outcome', description: JSON.stringify({ name, expected }) });
  await flush(page);
  const { clicks, keys, steps, startedAt } = measure;
  measure.outcomes.push({ name, expected, elapsedMs: Date.now() - startedAt, clicks, keys, steps });
  checkClickBudget(measure, name);
  await accessible(page, `outcome ${name}`);
}

/** The `outcome(name, expected)` check for one page. */
export function outcomes(page: Page) {
  return async function outcome(name: string, expected: Expected) {
    if (!namePattern.test(name)) {
      throw new Error(`The outcome name "${name}" is not kebab case, such as signed-in.`);
    }
    if (!expected.url && !expected.text) {
      throw new Error(`The outcome ${name} names no path and no text, so it would check nothing.`);
    }
    await test.step(`outcome ${name}`, async () => {
      if (expected.url !== undefined) {
        await expect
          .poll(() => new URL(page.url()).pathname, { message: `outcome ${name}: the path` })
          .toBe(expected.url);
      }
      if (expected.text !== undefined) {
        // An exact match, so `Pro` does not hold on `Upgrade to Pro`.
        await expect(
          page.getByText(expected.text, { exact: true }).first(),
          `outcome ${name}: the text`,
        ).toBeVisible();
      }
    });
    await record(page, name, expected);
  };
}
