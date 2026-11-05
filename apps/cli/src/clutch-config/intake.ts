import { isObject, isStringList, unknownKeys } from '@/clutch-config/checks';
import type { Errors } from '@/clutch-config/checks';
import { statuses } from '@/issues/parse';

/**
 * `factory.intake`: the work that is ready for the factory. `github` and
 * `linear` are issue labels. `tracker` is the `.clutch/issues` states that are
 * ready, for an issue with `owner: agent` outside `later`. C-Suite's GitHub
 * intake watches the `factory` label, so that is the default.
 */
export type Intake = { github: Array<string>; linear: Array<string>; tracker: Array<string> };

const defaultIntake: Intake = { github: ['factory'], linear: [], tracker: ['todo'] };

/** The intake of a project: its `factory.intake`, with the default for each key it leaves out. */
export function intakeOf(config: { factory?: { intake?: Intake } } | undefined): Intake {
  return config?.factory?.intake ?? defaultIntake;
}

const keys = ['github', 'linear', 'tracker'] as const;

/** A list of distinct, trimmed, non-blank names. `tracker` must name at least 1 issue state. */
function readList(key: (typeof keys)[number], value: unknown, errors: Errors) {
  const tracker = key === 'tracker';
  const ok =
    isStringList(value) &&
    value.every((item) => item.length > 0 && item.length <= 50 && item.trim() === item) &&
    new Set(value).size === value.length &&
    (!tracker ||
      (value.length > 0 &&
        value.every((item) => (statuses as ReadonlyArray<string>).includes(item))));
  if (!ok) {
    const what = tracker
      ? `at least 1 issue state from ${statuses.join(', ')}, each once`
      : 'a list of labels, each once, with no blank label';
    errors.push({ path: `factory.intake.${key}`, message: `Expected ${what}.` });
    return;
  }
  return value;
}

export function readIntake(value: unknown, errors: Errors): Intake | undefined {
  if (!isObject(value)) {
    errors.push({
      path: 'factory.intake',
      message: 'Expected a map with github, linear and tracker.',
    });
    return;
  }
  unknownKeys(value, [...keys], 'factory.intake', errors);
  const before = errors.length;
  const intake = { ...defaultIntake };
  for (const key of keys) {
    const list = value[key] === undefined ? undefined : readList(key, value[key], errors);
    if (list) {
      intake[key] = list;
    }
  }
  return errors.length === before ? intake : undefined;
}
