import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

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
 * keeps each name, so a check can compare the outcomes of the two copies.
 *
 * Each outcome that holds is recorded twice: as a test annotation, and as a
 * line in `<JOURNEY_OUTCOMES_DIR>/<journey id>.jsonl`, which the journey
 * runner reads. The runner fails a core journey whose run did not record each
 * outcome that the catalog names. See
 * https://github.com/eggdev/clutch/blob/main/docs/contributing/journeys/core.md.
 */

/** What the page shows when the outcome holds: its path, a visible text, or both. */
export type Expected = { url: string; text?: string } | { url?: string; text: string };

/** An outcome name is kebab case, such as `signed-in` or `card-declined`. */
const namePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

/** Records an outcome that held, for the journey runner and for a later compare. */
function record(name: string, expected: Expected) {
  const info = test.info();
  info.annotations.push({ type: 'outcome', description: JSON.stringify({ name, expected }) });
  const dir = process.env.JOURNEY_OUTCOMES_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    const journey = path.basename(info.file).replace(/\.pw\.ts$/u, '');
    appendFileSync(path.join(dir, `${journey}.jsonl`), `${JSON.stringify({ name, expected })}\n`);
  }
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
    record(name, expected);
  };
}
