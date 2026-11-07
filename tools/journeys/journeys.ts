import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * A journey proves one user goal through the real entry point. It lives in
 * `features/<feature>/journeys/`: `<id>.pw.ts` runs in a browser with
 * Playwright, and `<id>.maestro.yaml` runs on a device with Maestro. Its
 * header follows the journey specification in
 * `.agents/skills/setup-verification/references/journey-specification.md`.
 * See docs/contributing/setup/verification.md#journeys.
 */
export type Journey = {
  readonly id: string;
  readonly feature: string;
  /** The repository path of the journey file. */
  readonly file: string;
  readonly platform: 'web' | 'native';
};

const kinds = [
  ['.pw.ts', 'web'],
  ['.maestro.yaml', 'native'],
] as const;

/**
 * The core journeys that every product has, as `docs/contributing/journeys/core.md`
 * names them. A journey whose header has `Core: <name>` proves one of them.
 * The CLI keeps the same list in `apps/cli/src/clutch-config/core-journeys.ts`.
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

/**
 * The outcomes that each core journey proves, its failure states included, as
 * docs/contributing/journeys/core.md names them. A `Core:` journey asserts
 * each one, after `signed-up`. A test compares this list with the catalog.
 */
export const coreOutcomes: Readonly<Record<(typeof coreJourneys)[number], ReadonlyArray<string>>> =
  {
    'sign-up': ['signed-up', 'email-verified', 'email-taken-refused', 'weak-password-refused'],
    'sign-in': ['signed-out', 'signed-in', 'session-kept', 'wrong-password-refused'],
    onboarding: ['onboarded', 'onboarding-resumed', 'required-field-refused'],
    'profile-management': ['profile-saved', 'email-changed', 'invalid-field-refused'],
    'billing-and-checkout': ['plan-upgraded', 'plan-cancelled', 'card-declined', 'renewal-failed'],
    'roles-and-access': ['member-invited', 'member-joined', 'role-refused'],
    'account-security': ['password-changed', 'password-reset', 'wrong-password-refused'],
    'contact-support': ['support-request-sent', 'empty-request-refused'],
  };

/** The outcomes that a `Core: <name>` journey must record: `signed-up` first, then the catalog's. */
export function requiredOutcomes(name: (typeof coreJourneys)[number]): Array<string> {
  return [...new Set(['signed-up', ...coreOutcomes[name]])];
}

/** The verify config that registers each journey as a flow. */
export const verificationFile = '.agents/skills/verify/verification.json';

/** A journey that names no budget must finish in this many seconds. */
const defaultBudgetSeconds = 60;

/** The flow command that runs a journey. */
export const journeyCommand = (id: string) => ['mise', 'exec', '--', 'bun', 'run', 'journey', id];

function folders(root: string, parent: string): Array<string> {
  const folder = path.join(root, parent);
  return existsSync(folder)
    ? readdirSync(folder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];
}

/** Each journey file in each feature. */
export function journeys(root: string): Array<Journey> {
  return folders(root, 'features').flatMap((feature) => {
    const folder = path.join(root, 'features', feature, 'journeys');
    if (!existsSync(folder)) {
      return [];
    }
    return readdirSync(folder).flatMap((name) => {
      const kind = kinds.find(([suffix]) => name.endsWith(suffix));
      if (kind === undefined) {
        return [];
      }
      const [suffix, platform] = kind;
      return [
        {
          id: name.slice(0, -suffix.length),
          feature,
          file: `features/${feature}/journeys/${name}`,
          platform,
        },
      ];
    });
  });
}

/** The header lines of a journey, without the comment marks. */
export function headerOf(source: string): Array<string> {
  const lines = source.split('\n');
  if (lines[0]?.trim() === '/**') {
    const end = lines.findIndex((line) => line.trim() === '*/');
    return lines.slice(1, end).map((line) => line.replace(/^\s*\* ?/u, '').trimEnd());
  }
  const comments = lines.findIndex((line) => !line.startsWith('#'));
  return lines
    .slice(0, comments === -1 ? lines.length : comments)
    .map((line) => line.replace(/^# ?/u, '').trimEnd());
}

/** The lines of a journey after its header: the code that runs. */
export function bodyOf(source: string): string {
  const lines = source.split('\n');
  if (lines[0]?.trim() === '/**') {
    return lines.slice(lines.findIndex((line) => line.trim() === '*/') + 1).join('\n');
  }
  const comments = lines.findIndex((line) => !line.startsWith('#'));
  return comments === -1 ? '' : lines.slice(comments).join('\n');
}

/** The value of a `Name: value` line in a journey header. */
export function fieldOf(header: ReadonlyArray<string>, name: string): string | undefined {
  const line = header.find((item) => item.startsWith(`${name}:`));
  return line?.slice(name.length + 1).trim() || undefined;
}

/** The seconds that a journey may run, from the `Budget: <n> s` line of its header. */
export function budgetOf(root: string, journey: Journey): number {
  const value = fieldOf(headerOf(readFileSync(path.join(root, journey.file), 'utf-8')), 'Budget');
  const seconds = Number(value?.replace(/\s*s$/u, ''));
  return Number.isInteger(seconds) && seconds > 0 ? seconds : defaultBudgetSeconds;
}
