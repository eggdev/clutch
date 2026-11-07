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

/** A seed, a saved session, a token in storage, or a login through the API. */
const seeded =
  /\bseed(?:ed|s|ing)?\b|\bseed[A-Z_]|storageState|addCookies|addInitScript|localStorage|sessionStorage|\.request\b|\brequest\.(?:get|post|put|fetch)\b|\btest\.extend\b/u;

/** A way to change the URL that is not a tap: `location`, `window.open`, or `goto` by another name. */
const navigates =
  /\blocation\s*(?:\.\s*(?:assign|replace|href)|=)|\bwindow\.open\b|\[\s*['"`]goto['"`]\s*\]/u;

/** The source with its comments removed, so a commented-out call proves nothing. */
function code(body: string) {
  return body.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/(^|[^:'"`])\/\/[^\n]*/gu, '$1');
}

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
  const source = code(body);
  const problems: Array<string> = [];
  const opened = [...source.matchAll(/\.goto\(\s*([^,)]*)/gu)].map((match) => match[1]?.trim());
  if (opened.length === 0) {
    problems.push(`${file}: it never opens the entry. Start with \`page.goto('/')\`.`);
  }
  for (const url of new Set(opened.filter((item) => !/^(['"`])\/\1$/u.test(item ?? '')))) {
    problems.push(
      `${file}: it opens ${url}. A core journey opens only the entry, \`/\`, and reaches each screen through the app. See ${catalog}.`,
    );
  }
  if (navigates.test(source)) {
    problems.push(
      `${file}: it changes the URL without a tap. A core journey reaches each screen through the buttons that a user taps. See ${catalog}.`,
    );
  }
  if (seeded.test(source)) {
    problems.push(seedProblem(file));
  }
  const imports = [...source.matchAll(/\bfrom\s+(['"`])([^'"`]+)\1/gu)].map((match) => match[2]);
  for (const from of imports.filter(
    (item) => item !== '@playwright/test' && !item?.startsWith('@repo/journeys/testing/'),
  )) {
    problems.push(
      `${file}: it imports ${from}. A core journey imports only @playwright/test and @repo/journeys/testing, so every step is in the journey. See ${catalog}.`,
    );
  }
  if (/\bexpect\b/u.test(source)) {
    problems.push(
      `${file}: it asserts with \`expect\`. A core journey asserts only through \`outcome(name, expected)\` from @repo/journeys/testing/outcome. See ${catalog}.`,
    );
  }
  const calls = [...source.matchAll(/\boutcome\(\s*([^,)]*)/gu)].map(
    (match) => match[1]?.trim() ?? '',
  );
  if (calls.some((item) => !/^(['"`])[a-z0-9-]+\1$/u.test(item))) {
    problems.push(
      `${file}: an outcome name is not a literal string. Write each name as a string, such as \`outcome('signed-in', …)\`, so a check can read it. See ${catalog}.`,
    );
  }
  const seen = calls.map((item) => item.slice(1, -1));
  return [...problems, ...outcomeProblems(file, name, seen)];
}

type Step = { command: string; args: unknown };

/** Each Maestro command in the flow, also the commands inside `repeat` and `retry`. */
function stepsOf(value: unknown): Array<Step> {
  if (Array.isArray(value)) {
    return value.flatMap(stepsOf);
  }
  if (typeof value === 'string') {
    return [{ command: value, args: undefined }];
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([command, args]) => [
    { command, args },
    ...(typeof args === 'object' && args !== null && 'commands' in args
      ? stepsOf(args.commands)
      : []),
  ]);
}

const argOf = (step: Step, key: string) =>
  typeof step.args === 'object' && step.args !== null && key in step.args
    ? (step.args as Record<string, unknown>)[key]
    : undefined;

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
  if (seeded.test(body)) {
    problems.push(seedProblem(file));
  }
  const asserts = steps.filter((step) => step.command.startsWith('assert'));
  if (asserts.some((step) => !labelOf(step).startsWith('outcome '))) {
    problems.push(
      `${file}: it has an assertion with no \`label: outcome <name>\`. A core journey asserts only through outcomes. See ${catalog}.`,
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
