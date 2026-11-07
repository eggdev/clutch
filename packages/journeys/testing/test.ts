import { test as base } from '@playwright/test';
import { accessible } from '@repo/journeys/testing/a11y';
import {
  flush,
  layoutShiftProblem,
  startMeasure,
  writeMeasure,
} from '@repo/journeys/testing/measure';

/**
 * The `test` of every web journey. It is Playwright's `test`, and it measures
 * the browser context of `page`:
 *
 * - each layout shift with no recent input. A journey fails at the budget in
 *   `budgets.layoutShift` of clutch.yaml, and names the shifted element.
 * - each click, tap and key press. `outcome()` fails a core journey over its
 *   click budget.
 * - each axe result. It runs axe once more on the last page.
 *
 * A journey takes `test` from here, and `expect` from `@playwright/test`. See
 * https://github.com/eggdev/clutch/blob/main/docs/contributing/end-to-end-testing.md#measures.
 */
export const test = base.extend<{ journeyMeasure: null }>({
  journeyMeasure: [
    async ({ context, page }, use, info) => {
      const measure = await startMeasure(context, info);
      await use(null);
      const passed = info.status === info.expectedStatus;
      let failure: unknown = null;
      if (passed && !page.isClosed()) {
        // Kept, so the run still writes its measures before it fails.
        failure = await accessible(page, 'the last page').then(
          () => null,
          (error: unknown) => error,
        );
      }
      for (const open of context.pages()) {
        await flush(open);
      }
      const shift = passed ? layoutShiftProblem(measure) : null;
      failure ??= shift === null ? null : new Error(shift);
      writeMeasure(measure, {
        status: passed && failure === null ? 'passed' : 'failed',
        durationMs: Date.now() - measure.startedAt,
      });
      if (failure !== null) {
        throw failure;
      }
    },
    { auto: true },
  ],
});
