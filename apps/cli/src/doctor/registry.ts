import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'yaml';

const registryFile = 'docs/contributing/capabilities/registry.yaml';

const categories = [
  'Agent context',
  'Verification',
  'Lint & guardrails',
  'Trust',
  'Parallel work',
  'Review & merge',
  'Scale loops',
];
const phases = new Set(['P0', 'P1', 'P2', 'P3', 'P4', 'P5']);
const levels = new Set(['core', 'extra']);
const efforts = ['S', 'M', 'L', 'XL'];
const workflowFields = ['on', 'uses', 'run', 'pinned'];

export type WorkflowMatch = { on?: string; uses?: string; run?: string; pinned?: boolean };

export type Rule =
  | { file: string; min?: number; exclude?: Array<string> }
  | { grep: { files: string; pattern: string } }
  | { script: string }
  | { target: string }
  | { workflow: WorkflowMatch }
  | { yaml: { file: string; path: string } }
  | { remote: string }
  | { any: Array<Rule> }
  | { all: Array<Rule> };

export type CapabilityEntry = {
  id: string;
  name: string;
  category: string;
  phase: string;
  level: 'core' | 'extra';
  effort: string;
  research?: { rank: number; priority: number; adoption_top: number };
  doc: string;
  detect: Array<Rule>;
  partial_if?: Array<Rule>;
};

/** A problem in the registry. `id` names the entry, `field` the YAML path inside it. */
export type RegistryError = { id: string; field: string; message: string };

type Data = Record<string, unknown>;

function isObject(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown) => typeof value === 'string' && value.length > 0;

/** The problem with the body of one rule kind, or nothing when it is fine. */
const kindChecks: Record<string, (value: unknown) => string | undefined> = {
  file: (value) => (text(value) ? undefined : 'Expected a glob.'),
  grep: (value) =>
    isObject(value) && text(value.files) && text(value.pattern)
      ? undefined
      : 'Expected { files: <glob>, pattern: <regex> }.',
  script: (value) => (text(value) ? undefined : 'Expected a script name.'),
  target: (value) => (text(value) ? undefined : 'Expected a target name.'),
  workflow: (value) =>
    isObject(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((key) => workflowFields.includes(key))
      ? undefined
      : `Expected one or more of ${workflowFields.join(', ')}.`,
  yaml: (value) =>
    isObject(value) && text(value.file) && text(value.path)
      ? undefined
      : 'Expected { file: <path>, path: <dotted path> }.',
  remote: (value) => (text(value) ? undefined : 'Expected a probe name.'),
};

function checkRule(rule: unknown, at: string, fail: (field: string, message: string) => void) {
  if (!isObject(rule)) {
    fail(at, 'Expected a rule map.');
    return;
  }
  const kinds = Object.keys(rule).filter(
    (key) => key in kindChecks || key === 'any' || key === 'all',
  );
  if (kinds.length !== 1) {
    fail(at, 'Expected exactly one rule kind.');
    return;
  }
  const [kind] = kinds;
  const extra = Object.keys(rule).filter(
    (key) => key !== kind && !(kind === 'file' && (key === 'min' || key === 'exclude')),
  );
  for (const key of extra) {
    fail(`${at}.${key}`, 'Unknown key.');
  }
  const body = rule[kind];
  if (kind === 'any' || kind === 'all') {
    if (!Array.isArray(body) || body.length === 0) {
      fail(`${at}.${kind}`, 'Expected a list of rules.');
      return;
    }
    for (const [index, child] of body.entries()) {
      checkRule(child, `${at}.${kind}[${index}]`, fail);
    }
    return;
  }
  const problem = kindChecks[kind](body);
  if (problem) {
    fail(`${at}.${kind}`, problem);
  }
}

function checkRules(value: unknown, field: string, fail: (field: string, message: string) => void) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(field, 'Expected a list of rules.');
    return;
  }
  for (const [index, rule] of value.entries()) {
    checkRule(rule, `${field}[${index}]`, fail);
  }
}

/** Field checks for one entry. Each returns a problem, or nothing when the value is fine. */
const fieldChecks: Record<string, (value: unknown) => string | undefined> = {
  name: (value) => (text(value) ? undefined : 'Expected a name.'),
  category: (value) =>
    categories.includes(String(value)) ? undefined : `Expected one of ${categories.join(', ')}.`,
  phase: (value) =>
    phases.has(String(value)) ? undefined : `Expected one of ${[...phases].join(', ')}.`,
  level: (value) => (levels.has(String(value)) ? undefined : 'Expected core or extra.'),
  effort: (value) =>
    efforts.includes(String(value)) ? undefined : `Expected one of ${efforts.join(', ')}.`,
  doc: (value) =>
    typeof value === 'string' && /^docs\/contributing\/capabilities\/[a-z0-9-]+\.md$/u.test(value)
      ? undefined
      : 'Expected a page under docs/contributing/capabilities/.',
};

function checkEntry(entry: Data, index: number, errors: Array<RegistryError>) {
  const id = typeof entry.id === 'string' ? entry.id : `#${index}`;
  const fail = (field: string, message: string) => errors.push({ id, field, message });
  if (typeof entry.id !== 'string' || !/^[a-z][a-z0-9_]*$/u.test(entry.id)) {
    fail('id', 'Expected a snake_case id.');
  }
  for (const [field, check] of Object.entries(fieldChecks)) {
    const problem = check(entry[field]);
    if (problem) {
      fail(field, problem);
    }
  }
  checkRules(entry.detect, 'detect', fail);
  if (entry.partial_if !== undefined) {
    checkRules(entry.partial_if, 'partial_if', fail);
  }
}

/** Checks parsed registry data. Returns the entries only when there is no error. */
export function validateRegistry(data: unknown) {
  const errors: Array<RegistryError> = [];
  if (!isObject(data) || data.version !== 1 || !Array.isArray(data.capabilities)) {
    errors.push({ id: '', field: '', message: 'Expected version: 1 and a capabilities list.' });
    return { errors };
  }
  const seen = new Set<string>();
  for (const [index, entry] of (data.capabilities as Array<unknown>).entries()) {
    if (!isObject(entry)) {
      errors.push({ id: `#${index}`, field: '', message: 'Expected a map.' });
      continue;
    }
    checkEntry(entry, index, errors);
    if (typeof entry.id === 'string') {
      if (seen.has(entry.id)) {
        errors.push({ id: entry.id, field: 'id', message: 'The id is used twice.' });
      }
      seen.add(entry.id);
    }
  }
  return errors.length > 0
    ? { errors }
    : { capabilities: data.capabilities as Array<CapabilityEntry>, errors };
}

/** Reads and checks the registry in `root`. */
export async function loadRegistry(root: string) {
  return validateRegistry(parse(await readFile(path.join(root, registryFile), 'utf-8')));
}
