import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters as plain } from 'node:util';

import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { binding, pageScript } from '@repo/journeys/testing/measure-page';
import { budgetsFrom, clickBudgetAt, clickBudgetMessage } from '@repo/journeys/types/budget';
import type { Budgets } from '@repo/journeys/types/budget';

/**
 * The measures of one web journey run on one device: its layout shifts, its
 * clicks and keys, its outcomes, its axe results and its timings. The journey
 * test of `@repo/journeys/testing/test` starts a measure on the browser
 * context of `page`, and writes it to
 * `<JOURNEY_MEASURES_DIR>/<journey>/<device>-<retry>.json` at the end. The
 * journey runner joins those files into one file for each journey. See
 * https://github.com/eggdev/clutch/blob/main/docs/contributing/end-to-end-testing.md#measures.
 */

/** One layout shift with no recent input, in one document. */
export type Shift = {
  value: number;
  /** Milliseconds from the start of its document. */
  at: number;
  doc: string;
  page: string;
  elements: Array<string>;
};

type OutcomeMark = {
  name: string;
  expected: unknown;
  /** Milliseconds from the start of the test, so a later tool can measure the time to value. */
  elapsedMs: number;
  clicks: number;
  keys: number;
  steps: number;
};

type AxeMark = {
  where: string;
  /** Milliseconds from the start of the test. */
  elapsedMs: number;
  violations: Array<{ id: string; impact: string | null; nodes: number }>;
};

/**
 * What failed a try. A measured budget, `layout-shift`, `click-budget` or
 * `axe`, fails the run even when the retry passes. The retry covers only a
 * `crash`, a `timeout` or an `assertion` that throws.
 */
export type FailureKind =
  | 'layout-shift'
  | 'click-budget'
  | 'axe'
  | 'timeout'
  | 'assertion'
  | 'crash';

/** The failures that a retry does not cover. `tools/journeys/measures.ts` keeps the same set, and its test compares the two. */
export const budgetFailures: ReadonlySet<FailureKind> = new Set([
  'layout-shift',
  'click-budget',
  'axe',
]);

type Failure = { kind: FailureKind; message: string };

export type Measure = {
  journey: string;
  file: string;
  core: string | null;
  platform: 'web';
  device: string;
  retry: number;
  budgets: Budgets;
  startedAt: number;
  shifts: Array<Shift>;
  /**
   * Each activation: a click that a pointer or a key such as Space or Enter
   * fires, a choice in a `<select>`, or a form sent with Enter. A press and
   * hold or a drag that activates nothing does not count.
   */
  clicks: number;
  /** Each key press, typed characters included. */
  keys: number;
  /** What a click budget counts: each activation. */
  steps: number;
  outcomes: Array<OutcomeMark>;
  axe: Array<AxeMark>;
  /** The first thing that failed the try, or null. */
  failure: Failure | null;
  /** The click budget, once the outcome where it ends holds. */
  clickBudget: {
    budget: number;
    used: number;
    from: string;
    to: string;
  } | null;
  /** The layout problems of the last page of a passed try, or null. They are reported and never fail a try. */
  screen?: ScreenFindings | null;
};

/** The layout problems of the last page, one sentence each: as the person sees it, and at the largest text size. */
export type ScreenFindings = { asShown: Array<string>; largestText: Array<string> };

/** What a run writes: its measures, its result and its layout shift. */
export type Attempt = Omit<Measure, 'startedAt'> & {
  status: 'passed' | 'failed';
  durationMs: number;
  layoutShift: { value: number; page: string | null; elements: Array<string> };
};

const measures = new WeakMap<BrowserContext, Measure>();

/** The measure of the context that `page` is in, if the journey test started one. */
export const measureOf = (page: Page) => measures.get(page.context());

type PageEvent = ({ kind: 'shift' } & Shift) | { kind: 'click' } | { kind: 'key'; key: string };

/** Adds one event of the page script to the measure. */
function count(measure: Measure, event: PageEvent) {
  if (event.kind === 'shift') {
    const { kind: _kind, ...shift } = event;
    measure.shifts.push(shift);
  } else if (event.kind === 'click') {
    measure.clicks += 1;
    measure.steps += 1;
  } else {
    measure.keys += 1;
  }
}

/** Keeps the first failure of the try, so the measures file names what failed. */
export function markFailure(measure: Measure, kind: FailureKind, message: string) {
  measure.failure ??= { kind, message: plain(message) };
}

/** The kind of a try that failed with no measured budget: a timeout, a failed `expect`, or a crash. */
export function kindOf(info: Pick<TestInfo, 'status' | 'error'>): FailureKind {
  const message = plain(info.error?.message ?? '');
  if (info.status === 'timedOut' || /TimeoutError|Timeout \d+ms exceeded/u.test(message)) {
    return 'timeout';
  }
  // A missing screenshot baseline is a failed snapshot assertion too.
  return /expect(?:\.\w+)*\(|A snapshot doesn't exist/u.test(message) ? 'assertion' : 'crash';
}

/** The core journey that the `Core:` line of the journey header names, or null. */
export function coreOf(source: string): string | null {
  const header = source.trimStart().startsWith('/**') ? source.slice(0, source.indexOf('*/')) : '';
  return /^\s*\*\s*Core:\s*(\S+)/mu.exec(header)?.[1] ?? null;
}

/** The budgets of `JOURNEY_BUDGETS`, over the defaults. */
export function budgetsOf(text?: string): Budgets {
  return budgetsFrom((text ? JSON.parse(text) : {}) as Partial<Budgets>);
}

/** Starts the measure of a journey run on the context: the binding, then the page script. */
/** The fields of Playwright's `TestInfo` that a measure reads. */
export type MeasureInfo = Pick<TestInfo, 'file' | 'retry'> & {
  readonly project: Pick<TestInfo['project'], 'name'>;
};

export async function startMeasure(context: BrowserContext, info: MeasureInfo): Promise<Measure> {
  const measure: Measure = {
    journey: path.basename(info.file).replace(/\.(?:pw|journey)\.ts$/u, ''),
    file: path.relative(process.cwd(), info.file).split(path.sep).join('/'),
    core: coreOf(readFileSync(info.file, 'utf-8')),
    platform: 'web',
    device: info.project.name,
    retry: info.retry,
    budgets: budgetsOf(process.env.JOURNEY_BUDGETS),
    startedAt: Date.now(),
    shifts: [],
    clicks: 0,
    keys: 0,
    steps: 0,
    outcomes: [],
    axe: [],
    failure: null,
    clickBudget: null,
    screen: null,
  };
  await context.exposeBinding(binding, (_source, event: PageEvent) => count(measure, event));
  await context.addInitScript(pageScript);
  measures.set(context, measure);
  return measure;
}

/** Sends the layout shifts that the page has not sent yet. A closed page has nothing to send. */
export async function flush(page: Page) {
  if (!page.isClosed()) {
    // A navigation can end the document during the call. Its shifts were sent as they came.
    await page.evaluate('window.__clutchFlush?.()').catch(() => null);
  }
}

/**
 * The cumulative layout shift: the largest session window of shifts in one
 * document, as Chrome reports it. A window ends after a gap of 1 s, or 5 s
 * after it starts. Returns the window, with its elements, largest share first.
 * The value is not rounded, so the budget check compares the real sum.
 */
export function layoutShift(shifts: ReadonlyArray<Shift>): Attempt['layoutShift'] {
  let worst: { value: number; window: Array<Shift> } = { value: 0, window: [] };
  const docs = Map.groupBy(shifts, (shift) => shift.doc);
  for (const list of docs.values()) {
    let window: Array<Shift> = [];
    let sum = 0;
    for (const shift of list.toSorted((a, b) => a.at - b.at)) {
      const first = window[0];
      const last = window.at(-1);
      if (first && last && (shift.at - last.at > 1000 || shift.at - first.at > 5000)) {
        window = [];
        sum = 0;
      }
      window.push(shift);
      sum += shift.value;
      if (sum > worst.value) {
        worst = { value: sum, window: [...window] };
      }
    }
  }
  const share = new Map<string, number>();
  for (const shift of worst.window) {
    for (const element of shift.elements) {
      share.set(element, (share.get(element) ?? 0) + shift.value);
    }
  }
  return {
    value: worst.value,
    page: worst.window[0]?.page ?? null,
    elements: [...share.entries()].toSorted((a, b) => b[1] - a[1]).map(([element]) => element),
  };
}

/**
 * Checks the click budget of a core journey, when `name` is the outcome where
 * it ends, and keeps the count. Throws when the run took more steps than the budget.
 */
export function checkClickBudget(measure: Measure, name: string) {
  const { core } = measure;
  const mark = measure.outcomes.findLast((item) => item.name === name);
  const start = measure.outcomes.find((item) => item.name === 'signed-up');
  const check = clickBudgetAt(
    core,
    measure.budgets,
    name,
    mark?.steps ?? measure.steps,
    start?.steps ?? 0,
  );
  if (check === null || !core) {
    return;
  }
  measure.clickBudget = { budget: check.budget, used: check.used, from: check.from, to: name };
  if (check.over) {
    const message = clickBudgetMessage(core, check);
    markFailure(measure, 'click-budget', message);
    throw new Error(message);
  }
}

/** The message of a layout shift at or over the budget, or null. */
export function layoutShiftProblem(measure: Measure) {
  const shift = layoutShift(measure.shifts);
  if (shift.value < measure.budgets.layoutShift) {
    return null;
  }
  const elements = shift.elements.slice(0, 3).join(', ') || 'no element that Chrome named';
  // Rounded only to show it. The check above compares the real sum.
  const shown = Number(shift.value.toPrecision(3));
  return `The layout shift on ${shift.page ?? 'the page'} is ${shown}, at or over the budget of ${measure.budgets.layoutShift} in \`budgets.layoutShift\` of clutch.yaml. It moved ${elements}. Reserve the space of content that loads late. See docs/contributing/end-to-end-testing.md#budgets.`;
}

/** Writes the run's measures to `JOURNEY_MEASURES_DIR`, when the runner sets it. */
export function writeMeasure(measure: Measure, attempt: Pick<Attempt, 'status' | 'durationMs'>) {
  const dir = process.env.JOURNEY_MEASURES_DIR;
  if (!dir) {
    return;
  }
  const { startedAt: _startedAt, ...rest } = measure;
  const record: Attempt = {
    ...rest,
    ...attempt,
    layoutShift: layoutShift(measure.shifts),
  };
  const device = measure.device.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-');
  const folder = path.join(dir, measure.journey);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, `${device}-${measure.retry}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}
