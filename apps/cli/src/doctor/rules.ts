import path from 'node:path';

import { parse } from 'yaml';

import type { Rule, WorkflowMatch } from '@/doctor/registry';

type Outcome = 'pass' | 'fail' | 'unknown';
export type RuleResult = { outcome: Outcome; evidence: Array<string> };

/** What every rule reads: the tracked files, listed once, and their text. */
export type Context = {
  root: string;
  files: Array<string>;
  remote: boolean;
  read: (file: string) => Promise<string | undefined>;
};

/** The text of a tracked file. An untracked file, or one deleted from the working tree, is absent. */
async function readTracked(root: string, tracked: Set<string>, file: string) {
  const handle = Bun.file(path.join(root, file));
  return tracked.has(file) && (await handle.exists()) ? handle.text() : undefined;
}

/** A context for `root`. `files` is the output of `git ls-files`. Each file is read at most once. */
export function context(root: string, files: Array<string>, remote = false): Context {
  const tracked = new Set(files);
  const cache = new Map<string, Promise<string | undefined>>();
  const read = (file: string) => {
    let text = cache.get(file);
    if (!text) {
      text = readTracked(root, tracked, file);
      cache.set(file, text);
    }
    return text;
  };
  return { root, files, remote, read };
}

const pass = (evidence: Array<string>): RuleResult => ({ outcome: 'pass', evidence });
const fail: RuleResult = { outcome: 'fail', evidence: [] };

function matching(files: Array<string>, glob: string, exclude: Array<string> = []) {
  const include = new Bun.Glob(glob);
  const skip = exclude.map((pattern) => new Bun.Glob(pattern));
  return files.filter(
    (file) => include.match(file) && !skip.some((pattern) => pattern.match(file)),
  );
}

async function json(ctx: Context, file: string): Promise<Record<string, unknown> | undefined> {
  const text = await ctx.read(file);
  if (text === undefined) {
    return undefined;
  }
  try {
    return parse(text) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The values under `key` anywhere in `value`, such as every `uses:` in a workflow. */
function collect(value: unknown, key: string, found: Array<unknown> = []): Array<unknown> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collect(item, key, found);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [name, child] of Object.entries(value)) {
      if (name === key) {
        found.push(child);
      }
      collect(child, key, found);
    }
  }
  return found;
}

function events(on: unknown): Array<string> {
  if (typeof on === 'string') {
    return [on];
  }
  if (Array.isArray(on)) {
    return on.map(String);
  }
  return typeof on === 'object' && on !== null ? Object.keys(on) : [];
}

const pinnedRef = /@[0-9a-f]{40}$/u;

function workflowMatches(doc: Record<string, unknown>, match: WorkflowMatch) {
  // YAML 1.1 reads a bare `on:` key as the boolean true.
  const on = doc.on ?? doc.true;
  const uses = collect(doc.jobs, 'uses').map(String);
  const runs = collect(doc.jobs, 'run').map(String);
  if (match.on && !events(on).includes(match.on)) {
    return false;
  }
  if (match.uses && !uses.some((ref) => ref.startsWith(match.uses as string))) {
    return false;
  }
  if (match.run && !runs.some((script) => new RegExp(match.run as string, 'u').test(script))) {
    return false;
  }
  const remote = uses.filter((ref) => !ref.startsWith('./') && !ref.startsWith('docker://'));
  return !match.pinned || (remote.length > 0 && remote.every((ref) => pinnedRef.test(ref)));
}

function targetsOf(doc: Record<string, unknown> | undefined): object {
  const nx = doc?.nx as { targets?: object } | undefined;
  return (doc?.targets as object | undefined) ?? nx?.targets ?? {};
}

/** The first `package.json` or `project.json` that defines the Nx target `name`. */
async function targetIn(ctx: Context, name: string) {
  const files = ['package.json', ...matching(ctx.files, '**/{project,package}.json')];
  const docs = await Promise.all(files.map((file) => json(ctx, file)));
  return files.find((_, index) => Object.hasOwn(targetsOf(docs[index]), name));
}

function hasPath(doc: unknown, dotted: string) {
  let value = doc;
  for (const key of dotted.split('.')) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) {
      return false;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return true;
}

/** Combines child results. An unknown child counts only when every child is unknown. */
function combine(kind: 'any' | 'all', results: Array<RuleResult>): RuleResult {
  const evidence = results.flatMap((result) => result.evidence);
  const known = results.filter((result) => result.outcome !== 'unknown');
  if (known.length === 0) {
    return { outcome: 'unknown', evidence };
  }
  if (kind === 'any') {
    return known.some((result) => result.outcome === 'pass') ? pass(evidence) : fail;
  }
  if (known.some((result) => result.outcome === 'fail')) {
    return fail;
  }
  return known.length === results.length ? pass(evidence) : { outcome: 'unknown', evidence };
}

type Evaluator = (rule: never, ctx: Context) => Promise<RuleResult>;

/** One evaluator per rule kind. `any` and `all` are in `evaluate`. */
const evaluators: Record<string, Evaluator> = {
  file: (rule: { file: string; min?: number; exclude?: Array<string> }, ctx: Context) => {
    const found = matching(ctx.files, rule.file, rule.exclude);
    return Promise.resolve(found.length >= (rule.min ?? 1) ? pass(found) : fail);
  },
  grep: async (rule: { grep: { files: string; pattern: string } }, ctx: Context) => {
    const pattern = new RegExp(rule.grep.pattern, 'u');
    const files = matching(ctx.files, rule.grep.files);
    const texts = await Promise.all(files.map((file) => ctx.read(file)));
    const found = files.filter((_, index) => pattern.test(texts[index] ?? ''));
    return found.length > 0 ? pass(found) : fail;
  },
  script: async (rule: { script: string }, ctx: Context) => {
    const doc = await json(ctx, 'package.json');
    const scripts = doc?.scripts;
    return typeof scripts === 'object' && scripts !== null && Object.hasOwn(scripts, rule.script)
      ? pass([`package.json scripts.${rule.script}`])
      : fail;
  },
  target: async (rule: { target: string }, ctx: Context) => {
    const file = await targetIn(ctx, rule.target);
    return file ? pass([`${file} target ${rule.target}`]) : fail;
  },
  workflow: async (rule: { workflow: WorkflowMatch }, ctx: Context) => {
    const files = matching(ctx.files, '.github/workflows/*.{yml,yaml}');
    const docs = await Promise.all(files.map((file) => json(ctx, file)));
    const found = files.filter((_, index) => {
      const doc = docs[index];
      return doc !== undefined && workflowMatches(doc, rule.workflow);
    });
    return found.length > 0 ? pass(found) : fail;
  },
  yaml: async (rule: { yaml: { file: string; path: string } }, ctx: Context) => {
    const doc = await json(ctx, rule.yaml.file);
    return doc && hasPath(doc, rule.yaml.path)
      ? pass([`${rule.yaml.file} ${rule.yaml.path}`])
      : fail;
  },
  // A remote probe reads GitHub. CL-020 adds the probes behind --remote.
  remote: (rule: { remote: string }) =>
    Promise.resolve({ outcome: 'unknown', evidence: [`remote ${rule.remote} not checked`] }),
};

/** Evaluates one rule against the repository in `ctx`. */
export async function evaluate(rule: Rule, ctx: Context): Promise<RuleResult> {
  if ('any' in rule || 'all' in rule) {
    const kind = 'any' in rule ? 'any' : 'all';
    const children = 'any' in rule ? rule.any : rule.all;
    return combine(kind, await Promise.all(children.map((child) => evaluate(child, ctx))));
  }
  const kind = Object.keys(rule).find((key) => key in evaluators) as string;
  return evaluators[kind](rule as never, ctx);
}
