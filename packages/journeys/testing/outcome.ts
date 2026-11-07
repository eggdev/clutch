import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

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
 * keeps each name, so a check can compare the outcomes of the two copies. See
 * https://github.com/eggdev/clutch/blob/main/docs/contributing/journeys/core.md.
 */

/** What the page shows when the outcome holds: its path, a visible text, or both. */
export type Expected = { url: string; text?: string } | { url?: string; text: string };

/** An outcome name is kebab case, such as `signed-in` or `card-declined`. */
const namePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

/** The `outcome(name, expected)` check for one page. */
export function outcomes(page: Page) {
  return async function outcome(name: string, expected: Expected) {
    if (!namePattern.test(name)) {
      throw new Error(`The outcome name "${name}" is not kebab case, such as signed-in.`);
    }
    await test.step(`outcome ${name}`, async () => {
      if (expected.url !== undefined) {
        await expect
          .poll(() => new URL(page.url()).pathname, { message: `outcome ${name}: the path` })
          .toBe(expected.url);
      }
      if (expected.text !== undefined) {
        await expect(
          page.getByText(expected.text).first(),
          `outcome ${name}: the text`,
        ).toBeVisible();
      }
    });
  };
}
