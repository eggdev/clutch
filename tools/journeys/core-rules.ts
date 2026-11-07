import { bodyOf, coreJourneys, fieldOf, headerOf } from '@tools/journeys/journeys';
import type { Journey } from '@tools/journeys/journeys';
import { parseAllDocuments } from 'yaml';

/**
 * The rules for a journey with `Core: <name>` in its header. It proves a core
 * journey as the weakest real user meets it, so it:
 *
 * - opens only the entry: `/` on web, `launchApp` on native
 * - loads no seed fixture and no saved session
 * - creates its account through the sign-up screens, which the `signed-up`
 *   outcome proves
 * - asserts only through outcomes: `outcome(name, expected)` from
 *   `@repo/journeys/testing/outcome` on web, and an assertion with
 *   `label: outcome <name>` on native
 *
 * See docs/contributing/journeys/core.md.
 */

const catalog = 'docs/contributing/journeys/core.md';

/** A seed fixture, a seeded account or a saved session. */
const seeded = /seed|storageState|addCookies/iu;

const seedProblem = (file: string) =>
  `${file}: it loads a seed fixture or a saved session. A core journey makes a new account through the sign-up screens. See ${catalog}.`;

const signUpProblem = (file: string, form: string) =>
  `${file}: it does not create its account through the sign-up screens. Walk sign-up from the entry, and assert ${form}. See ${catalog}.`;

function webProblems(file: string, body: string): Array<string> {
  const problems: Array<string> = [];
  const opened = [...body.matchAll(/\.goto\(\s*([^,)]*)/gu)].map((match) => match[1]?.trim());
  if (opened.length === 0) {
    problems.push(`${file}: it never opens the entry. Start with \`page.goto('/')\`.`);
  }
  for (const url of new Set(opened.filter((item) => !/^(['"`])\/\1$/u.test(item ?? '')))) {
    problems.push(
      `${file}: it opens ${url}. A core journey opens only the entry, \`/\`, and reaches each screen through the app. See ${catalog}.`,
    );
  }
  if (seeded.test(body)) {
    problems.push(seedProblem(file));
  }
  if (!/\boutcome\(\s*(['"`])signed-up\1/u.test(body)) {
    problems.push(signUpProblem(file, "`outcome('signed-up', …)`"));
  }
  if (/\bexpect\s*[.(]/u.test(body)) {
    problems.push(
      `${file}: it asserts with \`expect\`. A core journey asserts only through \`outcome(name, expected)\` from @repo/journeys/testing/outcome. See ${catalog}.`,
    );
  }
  return problems;
}

type Step = { command: string; args: unknown };

/** Each Maestro command in the flow, also the commands inside `runFlow`, `repeat` and `retry`. */
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

const labelOf = (step: Step) =>
  typeof step.args === 'object' && step.args !== null && 'label' in step.args
    ? String(step.args.label)
    : '';

function nativeProblems(file: string, source: string, body: string): Array<string> {
  const documents = parseAllDocuments(source);
  const flow = Array.isArray(documents) ? documents.at(-1)?.toJS() : undefined;
  const steps = stepsOf(Array.isArray(flow) ? flow : []);
  const problems: Array<string> = [];
  if (!steps.some((step) => step.command === 'launchApp')) {
    problems.push(`${file}: it never opens the entry. Start with \`launchApp\`.`);
  }
  if (steps.some((step) => step.command === 'openLink')) {
    problems.push(
      `${file}: it opens a link. A core journey starts with \`launchApp\`, and reaches each screen through the app. See ${catalog}.`,
    );
  }
  if (seeded.test(body)) {
    problems.push(seedProblem(file));
  }
  const asserts = steps.filter((step) => step.command.startsWith('assert'));
  if (!asserts.some((step) => labelOf(step) === 'outcome signed-up')) {
    problems.push(signUpProblem(file, 'an outcome with `label: outcome signed-up`'));
  }
  if (asserts.some((step) => !labelOf(step).startsWith('outcome '))) {
    problems.push(
      `${file}: it has an assertion with no \`label: outcome <name>\`. A core journey asserts only through outcomes. See ${catalog}.`,
    );
  }
  return problems;
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
  const body = bodyOf(source);
  return journey.platform === 'web'
    ? webProblems(journey.file, body)
    : nativeProblems(journey.file, source, body);
}
