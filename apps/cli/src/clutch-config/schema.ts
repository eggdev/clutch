const capabilityStatuses = ['adopted', 'waived', 'n/a'] as const;
const modes = ['sync', 'doctor'] as const;

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
  template: { repo: string; commit: string; mode: (typeof modes)[number] };
  capabilities: Record<string, Capability>;
  worktree?: { root: string; copy: Array<string>; setup: Array<string> };
};

/** A problem in `clutch.yaml`, at a dotted YAML path such as `template.commit`. */
export type ConfigError = { path: string; message: string };

type Errors = Array<ConfigError>;
type Data = Record<string, unknown>;

const topKeys = ['schemaVersion', 'project', 'template', 'capabilities', 'worktree'];
const repoPattern = /^[\w.-]+\/[\w.-]+$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const capabilityId = /^[a-z][a-z0-9_]*$/u;
const issuePattern = /^CL-\d{3}[a-z]?$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

function isObject(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(values: ReadonlyArray<T>, value: unknown): value is T {
  return typeof value === 'string' && (values as ReadonlyArray<string>).includes(value);
}

function isStringList(value: unknown): value is Array<string> {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Adds an error for each key of `data` that `allowed` does not name. */
function unknownKeys(data: Data, allowed: Array<string>, at: string, errors: Errors) {
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) {
      errors.push({ path: at ? `${at}.${key}` : key, message: 'Unknown key.' });
    }
  }
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
    errors.push({ path: 'template', message: 'Expected a map with repo, commit and mode.' });
    return;
  }
  unknownKeys(value, ['repo', 'commit', 'mode'], 'template', errors);
  const { repo, commit, mode } = value;
  const before = errors.length;
  if (typeof repo !== 'string' || !repoPattern.test(repo)) {
    errors.push({ path: 'template.repo', message: 'Expected owner/name.' });
  }
  if (typeof commit !== 'string' || !commitPattern.test(commit)) {
    errors.push({ path: 'template.commit', message: 'Expected a full 40-character commit SHA.' });
  }
  if (!oneOf(modes, mode)) {
    errors.push({ path: 'template.mode', message: `Expected ${modes.join(' or ')}.` });
  }
  return errors.length === before
    ? {
        repo: repo as string,
        commit: commit as string,
        mode: mode as ClutchConfig['template']['mode'],
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
  unknownKeys(value, ['root', 'copy', 'setup'], 'worktree', errors);
  const { root, copy = [], setup = [] } = value;
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
  return errors.length === before
    ? { root: root as string, copy: copy as Array<string>, setup: setup as Array<string> }
    : undefined;
}

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
  const worktree = data.worktree === undefined ? undefined : readWorktree(data.worktree, errors);
  if (errors.length > 0 || !template) {
    return { errors };
  }
  const config: ClutchConfig = {
    schemaVersion: 1,
    project: data.project as string,
    template,
    capabilities,
  };
  if (worktree) {
    config.worktree = worktree;
  }
  return { config, errors };
}
