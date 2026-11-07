import { webFindings } from '@tools/journeys/core-web';
import {
  bodyOf,
  coreJourneys,
  fieldOf,
  headerOf,
  requiredOutcomes,
} from '@tools/journeys/journeys';
import type { Journey } from '@tools/journeys/journeys';
import { parseAllDocuments } from 'yaml';

/**
 * The rules for a journey with `Core: <name>` in its header. It proves a core
 * journey as the weakest real user meets it, so it:
 *
 * - opens only the entry: `page.goto('/')` on web, a clean `launchApp` first
 *   on native
 * - loads no seed fixture, no saved session and no token, and logs in through
 *   no API
 * - imports only `@playwright/test` and `@repo/journeys/testing/*`, so no
 *   helper in another file can do any of these
 * - asserts each outcome that the catalog names for it, `signed-up` first,
 *   with a literal name: `outcome('<name>', expected)` on web, and an
 *   assertion with `label: outcome <name>` on native
 * - asserts only through outcomes
 *
 * These read the source, so they are the fast first filter. The proof is the
 * run: `outcome()` records each outcome that held, and the journey runner
 * fails a core journey whose run did not record every one. See
 * docs/contributing/journeys/core.md.
 */

const catalog = 'docs/contributing/journeys/core.md';

const seedProblem = (file: string) =>
  `${file}: it loads a seed fixture, a saved session or a token, or logs in through the API. A core journey makes a new account through the sign-up screens. See ${catalog}.`;

function outcomeProblems(file: string, name: (typeof coreJourneys)[number], seen: Array<string>) {
  const problems: Array<string> = [];
  if (seen[0] !== 'signed-up') {
    problems.push(
      `${file}: it does not create its account through the sign-up screens first. Walk sign-up from the entry, and assert the \`signed-up\` outcome before any other. See ${catalog}.`,
    );
  }
  const missing = requiredOutcomes(name).filter((outcome) => !seen.includes(outcome));
  if (missing.length > 0) {
    problems.push(
      `${file}: it does not assert ${missing.map((item) => `\`${item}\``).join(', ')}, which the catalog names for ${name}. See ${catalog}.`,
    );
  }
  return problems;
}

function webProblems(file: string, name: (typeof coreJourneys)[number], body: string) {
  const { problems, seen } = webFindings(file, body);
  return [...problems, ...outcomeProblems(file, name, seen)];
}

type Step = { command: string; args: unknown; nested: boolean };

/** Each Maestro command in the flow, also the commands inside `repeat` and `retry`, which are `nested`. */
function stepsOf(value: unknown, nested = false): Array<Step> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => stepsOf(item, nested));
  }
  if (typeof value === 'string') {
    return [{ command: value, args: undefined, nested }];
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([command, args]) => [
    { command, args, nested },
    ...(typeof args === 'object' && args !== null && 'commands' in args
      ? stepsOf(args.commands, true)
      : []),
  ]);
}

const argOf = (step: Step, key: string) =>
  typeof step.args === 'object' && step.args !== null && key in step.args
    ? (step.args as Record<string, unknown>)[key]
    : undefined;

/** The Maestro commands that a user takes. Each outcome follows at least one. */
const nativeActions = new Set([
  'tapOn',
  'doubleTapOn',
  'longPressOn',
  'inputText',
  'inputRandomEmail',
  'inputRandomText',
  'inputRandomNumber',
  'inputRandomPersonName',
  'eraseText',
  'pressKey',
  'swipe',
  'scroll',
  'scrollUntilVisible',
  'back',
  'launchApp',
]);

const labelOf = (step: Step) => String(argOf(step, 'label') ?? '');

function nativeProblems(
  file: string,
  name: (typeof coreJourneys)[number],
  source: string,
  body: string,
) {
  const documents = parseAllDocuments(source);
  const flow = Array.isArray(documents) ? documents.at(-1)?.toJS() : undefined;
  const steps = stepsOf(Array.isArray(flow) ? flow : []);
  const problems: Array<string> = [];
  const [first] = steps;
  if (first?.command !== 'launchApp' || argOf(first, 'clearState') !== true) {
    problems.push(
      `${file}: it does not start with a clean launch. Start with \`launchApp: { clearState: true }\`, so the app holds no account. See ${catalog}.`,
    );
  }
  if (steps.some((step) => step.command === 'openLink')) {
    problems.push(
      `${file}: it opens a link. A core journey starts with \`launchApp\`, and reaches each screen through the app. See ${catalog}.`,
    );
  }
  if (steps.some((step) => step.command === 'runFlow')) {
    problems.push(
      `${file}: it runs another flow. A core journey keeps every step in its own file, so a check can read it. See ${catalog}.`,
    );
  }
  if (/\bseed(?:ed|s|ing)?\b|\bseed[A-Z_]|storageState|addCookies/u.test(body)) {
    problems.push(seedProblem(file));
  }
  if (steps.some((step) => step.command === 'runScript' || step.command === 'evalScript')) {
    problems.push(
      `${file}: it runs a script. A script can log in or seed, so a core journey takes only the steps that a user takes. See ${catalog}.`,
    );
  }
  const asserts = steps.filter((step) => step.command.startsWith('assert'));
  if (
    asserts.some(
      (step) =>
        step.nested ||
        argOf(step, 'optional') === true ||
        !['assertVisible', 'assertNotVisible'].includes(step.command),
    )
  ) {
    problems.push(
      `${file}: it has an assertion that may not run or may not check the screen: inside \`repeat\` or \`retry\`, \`optional\`, or not \`assertVisible\` or \`assertNotVisible\`. See ${catalog}.`,
    );
  }
  if (asserts.some((step) => !labelOf(step).startsWith('outcome '))) {
    problems.push(
      `${file}: it has an assertion with no \`label: outcome <name>\`. A core journey asserts only through outcomes. See ${catalog}.`,
    );
  }
  const idle: Array<string> = [];
  let stepped = false;
  for (const step of steps.slice(1)) {
    if (nativeActions.has(step.command)) {
      stepped = true;
    } else if (step.command.startsWith('assert') && labelOf(step).startsWith('outcome ')) {
      if (!stepped) {
        idle.push(labelOf(step).replace(/^outcome /u, ''));
      }
      stepped = false;
    }
  }
  if (idle.length > 0) {
    problems.push(
      `${file}: no user step comes before ${idle.map((item) => `\`${item}\``).join(', ')}. Each outcome comes after a tap, a text entry or a relaunch, so it cannot hold on the screen before. See ${catalog}.`,
    );
  }
  const seen = asserts.map((step) => labelOf(step).replace(/^outcome /u, ''));
  return [...problems, ...outcomeProblems(file, name, seen)];
}

/** What makes a journey with a `Core:` line break the catalog. A journey with no `Core:` line has none. */
export function coreProblems(journey: Journey, source: string): Array<string> {
  const name = fieldOf(headerOf(source), 'Core');
  if (name === undefined) {
    return [];
  }
  if (!(coreJourneys as ReadonlyArray<string>).includes(name)) {
    return [
      `${journey.file}: \`Core: ${name}\` names no core journey. Use one of ${coreJourneys.join(', ')}.`,
    ];
  }
  const core = name as (typeof coreJourneys)[number];
  const body = bodyOf(source);
  return journey.platform === 'web'
    ? webProblems(journey.file, core, body)
    : nativeProblems(journey.file, core, source, body);
}
