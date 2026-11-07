import { isObject, unknownKeys } from '@/clutch-config/checks';
import type { Errors } from '@/clutch-config/checks';

/**
 * The core journeys that every product has, as `docs/contributing/journeys/core.md`
 * names them. `tools/journeys/journeys.ts` keeps the same list for
 * `check-journeys`, because a project has the tools and not the CLI source.
 */
export const coreJourneys = [
  'sign-up',
  'sign-in',
  'onboarding',
  'profile-management',
  'billing-and-checkout',
  'roles-and-access',
  'account-security',
  'contact-support',
] as const;

export type CoreJourney = (typeof coreJourneys)[number];

/** Whether the project has a core journey. A journey it leaves out has a reason. */
export type CoreDecision = { status: 'adopted' } | { status: 'n/a'; reason: string };

const isCoreJourney = (key: string): key is CoreJourney =>
  (coreJourneys as ReadonlyArray<string>).includes(key);

/**
 * `coreJourneys`: one decision for each core journey, which kickoff records.
 * `adopted` in the short form, or `{ status: n/a, reason }`.
 */
export function readCoreJourneys(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({ path: 'coreJourneys', message: 'Expected a map of core journeys.' });
    return;
  }
  unknownKeys(value, [...coreJourneys], 'coreJourneys', errors);
  const before = errors.length;
  const decisions: Partial<Record<CoreJourney, CoreDecision>> = {};
  for (const name of coreJourneys) {
    const at = `coreJourneys.${name}`;
    const entry = value[name];
    if (entry === undefined) {
      errors.push({
        path: at,
        message:
          'Missing. Record adopted, or { status: n/a, reason } for a journey the project leaves out.',
      });
      continue;
    }
    if (entry === 'adopted') {
      decisions[name] = { status: 'adopted' };
      continue;
    }
    if (!isObject(entry) || entry.status !== 'n/a') {
      errors.push({
        path: at,
        message:
          'Expected adopted, or { status: n/a, reason } for a journey the project leaves out.',
      });
      continue;
    }
    unknownKeys(entry, ['status', 'reason'], at, errors);
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
      errors.push({
        path: `${at}.reason`,
        message: 'A journey that the project leaves out needs a reason.',
      });
      continue;
    }
    decisions[name] = { status: 'n/a', reason: entry.reason };
  }
  return errors.length === before ? (decisions as Record<CoreJourney, CoreDecision>) : undefined;
}

export type Budgets = {
  /** The cumulative layout shift limit of a journey. The template default is 0.01. */
  layoutShift?: number;
  /** The clicks or taps to finish each core journey. The template default for sign-up is 3. */
  clicks?: Partial<Record<CoreJourney, number>>;
  /** The seconds from the first screen to the activation event, which project intent names. */
  timeToValue?: { event: string; seconds: number };
};

const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;

function readClicks(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({ path: 'budgets.clicks', message: 'Expected a map of core journeys to clicks.' });
    return;
  }
  const clicks: Partial<Record<CoreJourney, number>> = {};
  for (const [name, count] of Object.entries(value)) {
    if (!isCoreJourney(name)) {
      errors.push({ path: `budgets.clicks.${name}`, message: 'Unknown key.' });
    } else if (isCount(count)) {
      clicks[name] = count;
    } else {
      errors.push({
        path: `budgets.clicks.${name}`,
        message: 'Expected a whole number, 1 or more.',
      });
    }
  }
  return clicks;
}

function readTimeToValue(value: unknown, errors: Errors) {
  const at = 'budgets.timeToValue';
  if (!isObject(value)) {
    errors.push({ path: at, message: 'Expected a map with event and seconds.' });
    return;
  }
  unknownKeys(value, ['event', 'seconds'], at, errors);
  const before = errors.length;
  if (typeof value.event !== 'string' || !value.event.trim()) {
    errors.push({ path: `${at}.event`, message: 'Expected the name of the activation event.' });
  }
  if (!isCount(value.seconds)) {
    errors.push({
      path: `${at}.seconds`,
      message: 'Expected a whole number of seconds, 1 or more.',
    });
  }
  return errors.length === before
    ? { event: value.event as string, seconds: value.seconds as number }
    : undefined;
}

/** `budgets`: the quality budgets of the core journeys, which kickoff fills. */
export function readBudgets(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({
      path: 'budgets',
      message: 'Expected a map with layoutShift, clicks or timeToValue.',
    });
    return;
  }
  unknownKeys(value, ['layoutShift', 'clicks', 'timeToValue'], 'budgets', errors);
  const before = errors.length;
  const { layoutShift } = value;
  if (
    layoutShift !== undefined &&
    !(typeof layoutShift === 'number' && layoutShift >= 0 && layoutShift < 1)
  ) {
    errors.push({
      path: 'budgets.layoutShift',
      message: 'Expected a number of at least 0 and below 1, such as 0.01.',
    });
  }
  const clicks = value.clicks === undefined ? undefined : readClicks(value.clicks, errors);
  const timeToValue =
    value.timeToValue === undefined ? undefined : readTimeToValue(value.timeToValue, errors);
  if (errors.length > before) {
    return;
  }
  const budgets: Budgets = {};
  if (layoutShift !== undefined) {
    budgets.layoutShift = layoutShift as number;
  }
  if (clicks !== undefined) {
    budgets.clicks = clicks;
  }
  if (timeToValue !== undefined) {
    budgets.timeToValue = timeToValue;
  }
  return budgets;
}
