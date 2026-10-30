import type { CapabilityEntry, Rule } from '@/doctor/registry';
import { context, evaluate } from '@/doctor/rules';
import type { Context, RuleResult } from '@/doctor/rules';
import { gitOrThrow } from '@/git';

export type Status = 'present' | 'partial' | 'missing' | 'unknown';
export type Detection = { id: string; status: Status; evidence: Array<string> };

/** The files that git tracks in `root`. An untracked file never counts as evidence. */
export async function trackedFiles(root: string) {
  const out = await gitOrThrow(root, 'ls-files', '-z');
  return out.split('\0').filter(Boolean);
}

function results(rules: Array<Rule>, ctx: Context) {
  return Promise.all(rules.map((rule) => evaluate(rule, ctx)));
}

/**
 * The status of one capability. Every `detect` rule passes: present. Some
 * pass, or only `partial_if` rules pass: partial. None pass: missing. Every
 * `detect` rule is unknown: unknown.
 */
async function detectOne(entry: CapabilityEntry, ctx: Context): Promise<Detection> {
  const main = await results(entry.detect, ctx);
  const evidence = main.flatMap((result) => result.evidence);
  const passed = main.filter((result) => result.outcome === 'pass').length;
  if (main.every((result) => result.outcome === 'unknown')) {
    return { id: entry.id, status: 'unknown', evidence };
  }
  if (passed === main.length) {
    return { id: entry.id, status: 'present', evidence };
  }
  if (passed > 0) {
    return { id: entry.id, status: 'partial', evidence };
  }
  const extra = await results(entry.partial_if ?? [], ctx);
  const partial = extra.filter((result) => result.outcome === 'pass');
  return partial.length > 0
    ? { id: entry.id, status: 'partial', evidence: partial.flatMap((result) => result.evidence) }
    : { id: entry.id, status: 'missing', evidence: [] };
}

/** Detects each capability in `root`. Git lists the tracked files once for the whole run. */
export async function detect(
  root: string,
  capabilities: Array<CapabilityEntry>,
  options: {
    remote?: boolean;
    probe?: (name: string) => Promise<RuleResult>;
    listFiles?: (root: string) => Promise<Array<string>>;
  } = {},
) {
  const files = await (options.listFiles ?? trackedFiles)(root);
  const ctx = { ...context(root, files, options.remote ?? false), probe: options.probe };
  return Promise.all(capabilities.map((entry) => detectOne(entry, ctx)));
}
