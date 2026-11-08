import { isObject, isStringList, unknownKeys } from '@/clutch-config/checks';
import type { Errors } from '@/clutch-config/checks';
import { readBudgets, readCoreJourneys } from '@/clutch-config/core-journeys';
import type { Budgets, CoreDecision, CoreJourney } from '@/clutch-config/core-journeys';
import type { Intake } from '@/clutch-config/intake';
import { readAutoRevert, readFactory, readJourneys } from '@/clutch-config/optional-keys';

const capabilityStatuses = ['adopted', 'waived', 'n/a'] as const;
const modes = ['sync', 'doctor'] as const;
const automergeModes = ['off', 'dry-run', 'on'] as const;
const automergeSteps = ['bots', 'low', 'medium'] as const;
const sastEngines = ['auto', 'codeql', 'semgrep'] as const;
const loginPattern = /^[a-z\d](?:[a-z\d-]{0,38})$/iu;

type CapabilityStatus = (typeof capabilityStatuses)[number];

type Capability = {
  status: CapabilityStatus;
  /** Why the capability is waived or does not apply. */
  reason?: string;
  /** The Clutch issue that adopts it. The waiver ends when that issue is done. */
  issue?: string;
  /** An ISO date. After it, the waiver fails `clutch doctor --check`. */
  until?: string;
};

export type ClutchConfig = {
  schemaVersion: 1;
  project: string;
  /**
   * `grace_days`: how long `sync --check` only warns when the project is behind
   * a release of the same major version. 14 by default.
   */
  template: { repo: string; mode: (typeof modes)[number]; grace_days?: number };
  capabilities: Record<string, Capability>;
  /** `check` is the command that tells whether a new checkout works. The default is in `worktree/settings.ts`. */
  worktree?: { root: string; copy: Array<string>; setup: Array<string>; check?: string };
  /** What the Auto-merge workflow does with a low-risk agent PR. */
  /** `step` is how far auto-merge reaches. `owner` is the login whose reactions grade the dry-run verdicts. */
  automerge?: {
    mode: (typeof automergeModes)[number];
    step?: (typeof automergeSteps)[number];
    owner?: string;
  };
  /** How `bun run pr` finds an agent's branch: its prefix, `clutch/cl-` by default. */
  pr?: { branchPrefix: string };
  /** What auto-revert judges main by, besides the required checks. `watch` names checks or jobs. */
  autoRevert?: { watch: Array<string> };
  /** The repositories that the weekly digest reads: each `owner/name` and the branch to read. */
  fleet?: Array<{ repo: string; ref: string }>;
  /**
   * The engine that `sast.yml` runs. auto, the default, runs CodeQL where code
   * scanning takes results and Semgrep elsewhere.
   */
  sast?: (typeof sastEngines)[number];
  /** When `clutch labels` warns about a large PR, and when a PR must split. */
  pr_size?: { warn: number; max?: number; exclude: Array<string> };
  /**
   * What agent-review.yml does without an Anthropic credential: pass with a
   * notice (the default), or fail, once agent review is a required check.
   */
  /** Whether the project has each core journey. See docs/contributing/journeys/core.md. */
  coreJourneys?: Record<CoreJourney, CoreDecision>;
  /** The quality budgets of the core journeys, which kickoff fills. */
  budgets?: Budgets;
  /** The app that a web journey drives. Without it, the runner finds the one web app under apps/. */
  journeys?: { webApp?: string; inbox?: Array<string> };
  /**
   * `root`: the folder of the factory tree, from the project root. `factory` by
   * default. `intake`: the labels and the tracker states that are ready for the
   * factory. See `clutch-config/intake.ts`.
   */
  factory?: { root?: string; intake?: Intake };
};

/** A problem in `clutch.yaml`, at a dotted YAML path such as `template.mode`. */
export type ConfigError = { path: string; message: string };

const topKeys = [
  'schemaVersion',
  'project',
  'template',
  'capabilities',
  'worktree',
  'automerge',
  'autoRevert',
  'pr',
  'fleet',
  'sast',
  'pr_size',
  'agentReview',
  'journeys',
  'coreJourneys',
  'budgets',
  'factory',
];
const repoPattern = /^[\w.-]+\/[\w.-]+$/u;
const capabilityId = /^[a-z][a-z0-9_]*$/u;
const issuePattern = /^CL-\d{3}[a-z]?$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

function oneOf<T extends string>(values: ReadonlyArray<T>, value: unknown): value is T {
  return typeof value === 'string' && (values as ReadonlyArray<string>).includes(value);
}

function isDate(value: unknown) {
  return (
    typeof value === 'string' &&
    datePattern.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
  );
}

function readTemplate(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({ path: 'template', message: 'Expected a map with repo and mode.' });
    return;
  }
  // An older clutch.yaml pins `commit`. Nothing reads it: a project follows the
  // latest Clutch release, and the next sync removes the key.
  unknownKeys(value, ['repo', 'commit', 'mode', 'grace_days'], 'template', errors);
  const { repo, mode, grace_days: graceDays } = value;
  const before = errors.length;
  if (typeof repo !== 'string' || !repoPattern.test(repo)) {
    errors.push({ path: 'template.repo', message: 'Expected owner/name.' });
  }
  if (!oneOf(modes, mode)) {
    errors.push({ path: 'template.mode', message: `Expected ${modes.join(' or ')}.` });
  }
  if (graceDays !== undefined && !(Number.isInteger(graceDays) && (graceDays as number) >= 0)) {
    errors.push({
      path: 'template.grace_days',
      message: 'Expected a whole number of days, 0 or more.',
    });
  }
  return errors.length === before
    ? {
        repo: repo as string,
        mode: mode as ClutchConfig['template']['mode'],
        ...(graceDays === undefined ? {} : { grace_days: graceDays as number }),
      }
    : undefined;
}

function readCapability(id: string, value: unknown, errors: Errors): Capability | undefined {
  const at = `capabilities.${id}`;
  const long = isObject(value) ? value : { status: value };
  if (isObject(value)) {
    unknownKeys(value, ['status', 'reason', 'issue', 'until'], at, errors);
  }
  const { status, reason, issue, until } = long;
  const before = errors.length;
  if (!oneOf(capabilityStatuses, status)) {
    errors.push({
      path: isObject(value) ? `${at}.status` : at,
      message: `Expected ${capabilityStatuses.join(', ')}.`,
    });
    return undefined;
  }
  if (status !== 'adopted' && (typeof reason !== 'string' || !reason.trim())) {
    errors.push({ path: `${at}.reason`, message: `A ${status} capability needs a reason.` });
  }
  if (reason !== undefined && typeof reason !== 'string') {
    errors.push({ path: `${at}.reason`, message: 'Expected a string.' });
  }
  if (issue !== undefined && (typeof issue !== 'string' || !issuePattern.test(issue))) {
    errors.push({ path: `${at}.issue`, message: 'Expected an issue id such as CL-102.' });
  }
  if (until !== undefined && !isDate(until)) {
    errors.push({ path: `${at}.until`, message: 'Expected an ISO date such as 2027-01-31.' });
  }
  if (errors.length > before) {
    return undefined;
  }
  const capability: Capability = { status };
  for (const [key, field] of [
    ['reason', reason],
    ['issue', issue],
    ['until', until],
  ] as const) {
    if (typeof field === 'string') {
      capability[key] = field;
    }
  }
  return capability;
}

function readCapabilities(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({ path: 'capabilities', message: 'Expected a map of capability ids.' });
    return {};
  }
  const capabilities: Record<string, Capability> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!capabilityId.test(id)) {
      errors.push({ path: `capabilities.${id}`, message: 'Expected a snake_case capability id.' });
      continue;
    }
    const capability = readCapability(id, entry, errors);
    if (capability) {
      capabilities[id] = capability;
    }
  }
  return capabilities;
}

function readWorktree(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({ path: 'worktree', message: 'Expected a map with root, copy and setup.' });
    return;
  }
  unknownKeys(value, ['root', 'copy', 'setup', 'check'], 'worktree', errors);
  const { root, copy = [], setup = [], check } = value;
  const before = errors.length;
  if (typeof root !== 'string' || !root) {
    errors.push({ path: 'worktree.root', message: 'Expected a folder path.' });
  }
  for (const [key, list] of [
    ['copy', copy],
    ['setup', setup],
  ] as const) {
    if (!isStringList(list)) {
      errors.push({ path: `worktree.${key}`, message: 'Expected a list of strings.' });
    }
  }
  if (check !== undefined && (typeof check !== 'string' || !check.trim())) {
    errors.push({ path: 'worktree.check', message: 'Expected a shell command.' });
  }
  if (errors.length !== before) {
    return;
  }
  const block = {
    root: root as string,
    copy: copy as Array<string>,
    setup: setup as Array<string>,
  };
  return check === undefined ? block : { ...block, check: check as string };
}

function readAutomerge(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({ path: 'automerge', message: 'Expected a map with mode.' });
    return;
  }
  unknownKeys(value, ['mode', 'step', 'owner'], 'automerge', errors);
  if (!oneOf(automergeModes, value.mode)) {
    errors.push({ path: 'automerge.mode', message: `Expected ${automergeModes.join(', ')}.` });
    return;
  }
  if (value.step !== undefined && !oneOf(automergeSteps, value.step)) {
    errors.push({ path: 'automerge.step', message: `Expected ${automergeSteps.join(', ')}.` });
    return;
  }
  const { owner } = value;
  if (owner !== undefined && (typeof owner !== 'string' || !loginPattern.test(owner))) {
    errors.push({ path: 'automerge.owner', message: 'Expected a GitHub login such as eggdev.' });
    return;
  }
  return {
    mode: value.mode,
    ...(value.step === undefined ? {} : { step: value.step }),
    ...(owner === undefined ? {} : { owner }),
  };
}

function readFleet(value: unknown, errors: Errors) {
  if (!Array.isArray(value)) {
    errors.push({ path: 'fleet', message: 'Expected a list of { repo, ref }.' });
    return;
  }
  const before = errors.length;
  const fleet: Array<{ repo: string; ref: string }> = [];
  for (const [index, entry] of value.entries()) {
    const at = `fleet[${index}]`;
    if (!isObject(entry)) {
      errors.push({ path: at, message: 'Expected a map with repo and ref.' });
      continue;
    }
    unknownKeys(entry, ['repo', 'ref'], at, errors);
    if (typeof entry.repo !== 'string' || !repoPattern.test(entry.repo)) {
      errors.push({ path: `${at}.repo`, message: 'Expected owner/name.' });
    }
    if (typeof entry.ref !== 'string' || !/^[\w./-]+$/u.test(entry.ref)) {
      errors.push({ path: `${at}.ref`, message: 'Expected a branch name, such as main.' });
    }
    fleet.push({ repo: entry.repo as string, ref: entry.ref as string });
  }
  return errors.length === before ? fleet : undefined;
}

function readPr(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({ path: 'pr', message: 'Expected a map with branchPrefix.' });
    return;
  }
  unknownKeys(value, ['branchPrefix'], 'pr', errors);
  if (typeof value.branchPrefix !== 'string' || !/^[\w./-]+$/u.test(value.branchPrefix)) {
    errors.push({
      path: 'pr.branchPrefix',
      message: 'Expected a branch prefix, such as clutch/cl-.',
    });
    return;
  }
  return { branchPrefix: value.branchPrefix };
}

function readPrSize(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({ path: 'pr_size', message: 'Expected a map with warn and exclude.' });
    return;
  }
  unknownKeys(value, ['warn', 'max', 'exclude'], 'pr_size', errors);
  const { warn = 300, max, exclude = [] } = value;
  const before = errors.length;
  for (const [key, lines] of [
    ['warn', warn],
    ['max', max ?? 1],
  ] as const) {
    if (typeof lines !== 'number' || !Number.isInteger(lines) || lines < 1) {
      errors.push({ path: `pr_size.${key}`, message: 'Expected a whole number of lines.' });
    }
  }
  if (!isStringList(exclude)) {
    errors.push({ path: 'pr_size.exclude', message: 'Expected a list of globs.' });
  }
  return errors.length === before
    ? { warn: warn as number, max: max as number | undefined, exclude: exclude as Array<string> }
    : undefined;
}

/** The optional sections. Each reader returns the typed value, or nothing after an error. */
const optionalSections: Record<string, (value: unknown, errors: Errors) => unknown> = {
  worktree: readWorktree,
  automerge: readAutomerge,
  autoRevert: readAutoRevert,
  pr: readPr,
  fleet: readFleet,
  pr_size: readPrSize,
  journeys: readJourneys,
  coreJourneys: readCoreJourneys,
  budgets: readBudgets,
  factory: readFactory,
};

/** Checks parsed `clutch.yaml` data. Returns the typed config only when there is no error. */
export function validateClutchConfig(data: unknown): { config?: ClutchConfig; errors: Errors } {
  const errors: Errors = [];
  if (!isObject(data)) {
    return { errors: [{ path: '', message: 'Expected a YAML map at the top level.' }] };
  }
  unknownKeys(data, topKeys, '', errors);
  if (data.schemaVersion !== 1) {
    errors.push({ path: 'schemaVersion', message: 'Expected 1.' });
  }
  if (typeof data.project !== 'string' || !data.project.trim()) {
    errors.push({ path: 'project', message: 'Expected a short project name.' });
  }
  const template = readTemplate(data.template, errors);
  const capabilities = readCapabilities(data.capabilities, errors);
  const sections: Record<string, unknown> = {};
  for (const [key, read] of Object.entries(optionalSections)) {
    const value = data[key] === undefined ? undefined : read(data[key], errors);
    if (value !== undefined) {
      sections[key] = value;
    }
  }
  if (data.sast !== undefined && !oneOf(sastEngines, data.sast)) {
    errors.push({ path: 'sast', message: `Expected ${sastEngines.join(', ')}.` });
  }
  if (errors.length > 0 || !template) {
    return { errors };
  }
  const config: ClutchConfig = {
    schemaVersion: 1,
    project: data.project as string,
    template,
    capabilities,
    ...sections,
  };
  if (oneOf(sastEngines, data.sast)) {
    config.sast = data.sast;
  }
  return { config, errors };
}
