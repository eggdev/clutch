/** The risk tiers, lowest first. A higher tier needs more human review before a merge. */
const tiers = ['low', 'medium', 'high', 'one-way-door'] as const;

export type Tier = (typeof tiers)[number];

/**
 * One rule of `.clutch/risk.yaml`. `guardrails` names a JSON file whose
 * `patterns` join `paths`. A file that matches `except` does not match the rule.
 * With `lines`, a file matches only when one of its added or removed lines
 * matches one of these regular expressions, such as a workflow's `permissions:`.
 */
type Rule = {
  tier: Tier;
  paths: Array<string>;
  except: Array<string>;
  guardrails?: string;
  lines?: Array<string>;
};

export type RiskConfig = { unmatched: Tier; rules: Array<Rule> };

/** The tier of one changed file, and the pattern that gave it. No pattern means `unmatched`. */
export type FileTier = { path: string; tier: Tier; pattern?: string };

/** A problem in `.clutch/risk.yaml`, at a dotted YAML path such as `rules.0.tier`. */
export type RiskError = { path: string; message: string };

type Data = Record<string, unknown>;

function isObject(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (tiers as ReadonlyArray<string>).includes(value);
}

const tierMessage = `Expected ${tiers.join(', ')}.`;

function isRegex(value: unknown) {
  if (typeof value !== 'string' || !value) {
    return false;
  }
  try {
    return new RegExp(value, 'u') instanceof RegExp;
  } catch {
    return false;
  }
}

function readRule(value: unknown, at: string, errors: Array<RiskError>): Rule | undefined {
  if (!isObject(value)) {
    errors.push({ path: at, message: 'Expected a map with tier and paths.' });
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!['tier', 'paths', 'except', 'guardrails', 'lines'].includes(key)) {
      errors.push({ path: `${at}.${key}`, message: 'Unknown key.' });
    }
  }
  const { tier, paths = [], except = [], guardrails, lines } = value;
  const before = errors.length;
  if (!isTier(tier)) {
    errors.push({ path: `${at}.tier`, message: tierMessage });
  }
  for (const [key, list] of [
    ['paths', paths],
    ['except', except],
  ] as const) {
    if (!Array.isArray(list) || !list.every((item) => typeof item === 'string')) {
      errors.push({ path: `${at}.${key}`, message: 'Expected a list of globs.' });
    }
  }
  if (guardrails !== undefined && (typeof guardrails !== 'string' || !guardrails)) {
    errors.push({ path: `${at}.guardrails`, message: 'Expected the path of a JSON file.' });
  }
  if (
    lines !== undefined &&
    (!Array.isArray(lines) || lines.length === 0 || !lines.every(isRegex))
  ) {
    errors.push({ path: `${at}.lines`, message: 'Expected a list of regular expressions.' });
  }
  if (errors.length > before) {
    return undefined;
  }
  const rule: Rule = {
    tier: tier as Tier,
    paths: paths as Array<string>,
    except: except as Array<string>,
  };
  if (typeof guardrails === 'string') {
    rule.guardrails = guardrails;
  }
  if (lines !== undefined) {
    rule.lines = lines as Array<string>;
  }
  return rule;
}

/** Checks parsed `.clutch/risk.yaml` data. Returns the typed config only when there is no error. */
export function validateRiskConfig(data: unknown): {
  config?: RiskConfig;
  errors: Array<RiskError>;
} {
  if (!isObject(data)) {
    return { errors: [{ path: '', message: 'Expected a YAML map at the top level.' }] };
  }
  const errors: Array<RiskError> = [];
  for (const key of Object.keys(data)) {
    if (!['schemaVersion', 'unmatched', 'rules'].includes(key)) {
      errors.push({ path: key, message: 'Unknown key.' });
    }
  }
  if (data.schemaVersion !== 1) {
    errors.push({ path: 'schemaVersion', message: 'Expected 1.' });
  }
  if (!isTier(data.unmatched)) {
    errors.push({ path: 'unmatched', message: tierMessage });
  }
  if (!Array.isArray(data.rules) || data.rules.length === 0) {
    errors.push({ path: 'rules', message: 'Expected a list of rules.' });
    return { errors };
  }
  const rules = data.rules.map((rule, index) => readRule(rule, `rules.${index}`, errors));
  if (errors.length > 0) {
    return { errors };
  }
  return { config: { unmatched: data.unmatched as Tier, rules: rules as Array<Rule> }, errors };
}

const rank = (tier: Tier) => tiers.indexOf(tier);

/** The higher of two tiers. */
const higher = (a: Tier, b: Tier) => (rank(a) >= rank(b) ? a : b);

/**
 * Gives each file the highest tier of the rules whose globs match it. A file
 * that no rule matches gets `unmatched`. `rules` must already hold the
 * guardrail patterns in their `paths`. `changed` holds the added and removed
 * lines of each file, for the rules with `lines`. A file it does not hold
 * matches such a rule, so a missing diff never lowers a tier.
 */
export function classify(
  config: RiskConfig,
  files: Array<string>,
  changed = new Map<string, Array<string>>(),
): Array<FileTier> {
  const globs = config.rules.flatMap((rule) => {
    const except = rule.except.map((pattern) => new Bun.Glob(pattern));
    const lines = rule.lines?.map((source) => new RegExp(source, 'iu'));
    return rule.paths.map((pattern) => ({
      tier: rule.tier,
      pattern,
      glob: new Bun.Glob(pattern),
      except,
      lines,
    }));
  });
  const linesMatch = (file: string, lines: Array<RegExp> | undefined) => {
    const diff = changed.get(file);
    return !lines || !diff || diff.some((line) => lines.some((regex) => regex.test(line)));
  };
  return files.map((file) => {
    let found: FileTier | undefined;
    for (const { tier, pattern, glob, except, lines } of globs) {
      if (
        (!found || rank(tier) > rank(found.tier)) &&
        glob.match(file) &&
        !except.some((skip) => skip.match(file)) &&
        linesMatch(file, lines)
      ) {
        found = { path: file, tier, pattern };
      }
    }
    return found ?? { path: file, tier: config.unmatched };
  });
}

/** Whether a rule reads changed lines, so `clutch risk` needs the diff of `file`. */
export function needsLines(config: RiskConfig, file: string) {
  return config.rules.some(
    (rule) => rule.lines && rule.paths.some((pattern) => new Bun.Glob(pattern).match(file)),
  );
}

/** The tier of a change: the highest tier of its files. A change with no file is `low`. */
export function changeTier(files: Array<FileTier>) {
  let tier: Tier = 'low';
  for (const file of files) {
    tier = higher(tier, file.tier);
  }
  return tier;
}
