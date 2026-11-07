import { test as base } from '@playwright/test';
import { accessible } from '@repo/journeys/testing/a11y';
import {
  flush,
  kindOf,
  layoutShiftProblem,
  markFailure,
  startMeasure,
  writeMeasure,
} from '@repo/journeys/testing/measure';

/**
 * The `test` of every web journey. It is Playwright's `test`, and it measures
 * the browser context of `page`:
 *
 * - each layout shift with no recent input. A try fails at the budget in
 *   `budgets.layoutShift` of clutch.yaml, and names the shifted element.
 * - each activation: a click or tap, a key that clicks a button, and a choice
 *   in a `<select>`. `outcome()` fails a core journey over its click budget.
 * - each axe result. `outcome()` runs axe after each outcome holds, and this
 *   runs it once more on the last page.
 *
 * A measured budget that fails on any try fails the run, even when the retry
 * passes. The measures file names the kind of each failure. A journey takes
 * `test` from here, and `expect` from `@playwright/test`. See
 * https://github.com/eggdev/clutch/blob/main/docs/contributing/end-to-end-testing.md#measures.
 */
export const test = base.extend<{ journeyMeasure: null }>({
  journeyMeasure: [
    async ({ context, page }, use, info) => {
      const measure = await startMeasure(context, info);
      await use(null);
      const passed = info.status === info.expectedStatus;
      let thrown: unknown = null;
      if (passed && !page.isClosed()) {
        // Kept, so the run still writes its measures before it fails.
        thrown = await accessible(page, 'the last page').then(
          () => null,
          (error: unknown) => error,
        );
      }
      for (const open of context.pages()) {
        await flush(open);
      }
      // Checked on every try, so a shift on a try that also failed for another reason still counts.
      const shift = layoutShiftProblem(measure);
      if (shift !== null) {
        markFailure(measure, 'layout-shift', shift);
        thrown ??= passed ? new Error(shift) : null;
      }
      if (!passed) {
        markFailure(
          measure,
          kindOf(info),
          info.error?.message ?? `The try ended as ${info.status}.`,
        );
      }
      writeMeasure(measure, {
        status: passed && thrown === null ? 'passed' : 'failed',
        durationMs: Date.now() - measure.startedAt,
      });
      if (thrown !== null) {
        throw thrown;
      }
    },
    { auto: true },
  ],
});
