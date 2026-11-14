import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The list of guardrail files: each file that configures a check, a lint rule,
 * a budget or a hook. `patterns` covers them all. `held` is the part that the
 * merge judge holds, see tools/github/guardrail-hold.ts. `exempt` names a file
 * that tooling reads but that sets no rule. See
 * docs/contributing/harness-engineering.md#guardrail-files.
 */
export const guardrailList = 'tools/guardrail-files.json';

export type GuardrailList = {
  patterns: Array<string>;
  held?: Array<string>;
  exempt?: Record<string, string>;
};

/** The guardrail patterns of the checkout at `root`. */
export function guardrailPatterns(root: string): Array<string> {
  const list = JSON.parse(readFileSync(path.join(root, guardrailList), 'utf-8')) as GuardrailList;
  return list.patterns;
}
