import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters as plain } from 'node:util';

import type { BrowserContext, Page, TestInfo } from '@playwright/test';

/**
 * The measures of one web journey run on one device: its layout shifts, its
 * clicks and keys, its outcomes, its axe results and its timings. The journey
 * test of `@repo/journeys/testing/test` starts a measure on the browser
 * context of `page`, and writes it to
 * `<JOURNEY_MEASURES_DIR>/<journey>/<device>-<retry>.json` at the end. The
 * journey runner joins those files into one file for each journey. See
 * https://github.com/eggdev/clutch/blob/main/docs/contributing/end-to-end-testing.md#measures.
 */

/** The quality budgets of a run, from `budgets:` in clutch.yaml, which the runner passes in `JOURNEY_BUDGETS`. */
export type Budgets = { layoutShift: number; clicks: Record<string, number> };

/** The template defaults, as docs/contributing/journeys/core.md names them. */
const defaultBudgets: Budgets = { layoutShift: 0.01, clicks: { 'sign-up': 3 } };

/**
 * The outcome where the click budget of each core journey ends. Sign-up counts
 * from the entry. Each other journey counts from `signed-up`.
 */
const budgetEnd: Readonly<Record<string, string>> = {
  'sign-up': 'signed-up',
  'sign-in': 'signed-in',
  onboarding: 'onboarded',
  'profile-management': 'profile-saved',
  'billing-and-checkout': 'plan-upgraded',
  'roles-and-access': 'member-invited',
  'account-security': 'password-changed',
  'contact-support': 'support-request-sent',
};

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
};

/** What a run writes: its measures, its result and its layout shift. */
export type Attempt = Omit<Measure, 'startedAt'> & {
  status: 'passed' | 'failed';
  durationMs: number;
  layoutShift: { value: number; page: string | null; elements: Array<string> };
};

const measures = new WeakMap<BrowserContext, Measure>();

/** The measure of the context that `page` is in, if the journey test started one. */
export const measureOf = (page: Page) => measures.get(page.context());

/** The binding that the page script calls, and the flush it defines. */
const binding = '__clutchMeasure';

/**
 * Runs in each document of the context, before the app. It sends each click,
 * key press and layout shift with no recent input to the binding. A string,
 * since this package's types have no DOM.
 */
const pageScript = `(() => {
  if (window !== window.top || window.__clutchFlush) return;
  const doc = Math.random().toString(36).slice(2);
  const send = (event) => window.${binding}(event);
  const describe = (node) => {
    const element = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!element) return 'an element that is gone';
    let name = element.tagName.toLowerCase();
    if (element.id) name += '#' + element.id;
    for (const attribute of ['data-testid', 'aria-label']) {
      const value = element.getAttribute(attribute);
      if (value) name += '[' + attribute + '="' + value + '"]';
    }
    const line = (element.innerText || element.textContent || '').trim().split('\\n')[0] || '';
    const text = line.replace(/\\s+/g, ' ').slice(0, 40);
    return text ? name + ' "' + text + '"' : name;
  };
  const shifts = (entries) =>
    entries
      .filter((entry) => !entry.hadRecentInput)
      .map((entry) =>
        send({
          kind: 'shift',
          doc,
          page: location.pathname,
          at: entry.startTime,
          value: entry.value,
          elements: (entry.sources || []).map((source) => describe(source.node)),
        }),
      );
  const observer = new PerformanceObserver((list) => shifts(list.getEntries()));
  observer.observe({ type: 'layout-shift', buffered: true });
  window.__clutchFlush = () => Promise.all(shifts(observer.takeRecords()));
  // An element that a press activates. A press on anything else counts only as a short, still tap.
  const control =
    'a[href], button, input, select, textarea, summary, label, [contenteditable=""], [contenteditable="true"], ' +
    ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option']
      .map((role) => '[role="' + role + '"]')
      .join(', ');
  // One activation in each task, so a label that clicks its field, or a click
  // that sends a form, counts once.
  let counted = false;
  const activate = () => {
    if (counted) return;
    counted = true;
    setTimeout(() => (counted = false), 0);
    send({ kind: 'click' });
  };
  let press = null;
  addEventListener('pointerdown', (event) => {
    if (event.isTrusted && event.isPrimary) press = { x: event.clientX, y: event.clientY, at: event.timeStamp };
  }, true);
  addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const down = press;
    press = null;
    // A key, such as Space or Enter on a button, fires a click with no pointer.
    const fromKey = event.detail === 0;
    const onControl = event.target instanceof Element && event.target.closest(control) !== null;
    const tap =
      down !== null &&
      Math.hypot(event.clientX - down.x, event.clientY - down.y) < 10 &&
      event.timeStamp - down.at < 500;
    if (fromKey || onControl || tap) activate();
  }, true);
  // A choice in a <select> fires no click. A test driver fires the change itself, so it is not trusted.
  addEventListener('change', (event) => {
    if (event.target instanceof HTMLSelectElement) activate();
  }, true);
  // Enter in a form with no submit button sends it with no click.
  addEventListener('submit', (event) => {
    if (event.isTrusted && event.submitter === null) activate();
  }, true);
  addEventListener('keydown', (event) => {
    if (event.isTrusted && !event.repeat) send({ kind: 'key', key: event.key });
  }, true);
})();`;

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
  const given = (text ? JSON.parse(text) : {}) as Partial<Budgets>;
  return {
    layoutShift: given.layoutShift ?? defaultBudgets.layoutShift,
    clicks: { ...defaultBudgets.clicks, ...given.clicks },
  };
}

/** Starts the measure of a journey run on the context: the binding, then the page script. */
export async function startMeasure(context: BrowserContext, info: TestInfo): Promise<Measure> {
  const measure: Measure = {
    journey: path.basename(info.file).replace(/\.pw\.ts$/u, ''),
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
  const budget = core ? measure.budgets.clicks[core] : undefined;
  if (!core || budget === undefined || budgetEnd[core] !== name) {
    return;
  }
  const mark = measure.outcomes.findLast((item) => item.name === name);
  const start =
    core === 'sign-up' ? null : measure.outcomes.find((item) => item.name === 'signed-up');
  const from = core === 'sign-up' ? 'the entry' : '`signed-up`';
  const used = (mark?.steps ?? measure.steps) - (start?.steps ?? 0);
  measure.clickBudget = { budget, used, from, to: name };
  if (used > budget) {
    const message = `${core} took ${used} clicks or taps from ${from} to \`${name}\`, over its budget of ${budget} in \`budgets.clicks\` of clutch.yaml. Remove a step. A larger budget is the owner's decision. See docs/contributing/journeys/core.md#budgets.`;
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
