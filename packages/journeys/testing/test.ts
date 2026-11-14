import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import { accessible } from '@repo/journeys/testing/a11y';
import {
  flush,
  kindOf,
  layoutShiftProblem,
  markFailure,
  startMeasure,
  writeMeasure,
} from '@repo/journeys/testing/measure';
import type { Measure, ScreenFindings } from '@repo/journeys/testing/measure';
import { atLargestText, screenProblems } from '@repo/journeys/testing/screen';

/**
 * The screen findings of the last page: its layout problems as shown, and at
 * the largest text size. The font change makes layout shifts that no person
 * causes, so the shifts that it sends are dropped from the measure.
 */
async function findingsOf(page: Page, measure: Measure): Promise<ScreenFindings> {
  const before = measure.shifts.length;
  const asShown = await screenProblems(page);
  const largestText = await atLargestText(page, () => screenProblems(page));
  // The page sends each shift a moment after it happens, so two frames pass first.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await flush(page);
  measure.shifts.splice(before);
  return { asShown, largestText };
}

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
 * - each layout problem of the last page, as shown and at the largest text
 *   size. A passed try records them, and they never fail it.
 *
 * A journey runs once on each device, with no retry, so a failed budget fails
 * the run. The measures file names the kind of each failure. A journey takes
 * `test` from here, and `expect` from `@playwright/test`. See
 * https://github.com/eggdev/clutch/blob/main/docs/contributing/end-to-end-testing.md#measures.
 */
export const test = base.extend<{ journeyMeasure: null }>({
  journeyMeasure: [
    async ({ context, page }, use, info) => {
      // A data journey registers its test from journey.ts, so the file of the journey comes from its annotation.
      const declared = info.annotations.find((item) => item.type === 'journey-file')?.description;
      const measure = await startMeasure(context, {
        file: declared ?? info.file,
        retry: info.retry,
        project: info.project,
      });
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
      // Reported in the measures, and never a failure of the try.
      if (passed && !page.isClosed()) {
        measure.screen = await findingsOf(page, measure);
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
