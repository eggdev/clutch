import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { parse } from 'yaml';

import { git, gitOrThrow } from '@/git';
import { changeTier, classify, validateRiskConfig } from '@/risk/tiers';
import type { RiskConfig } from '@/risk/tiers';

const riskFile = '.clutch/risk.yaml';

/** The repository that holds `cwd`, or `cwd` when it is not in one. */
async function repoRoot(cwd: string) {
  const top = await git(cwd, 'rev-parse', '--show-toplevel');
  return top.ok ? top.out : cwd;
}

/** The remote default branch, such as `origin/main`, or `main` when the clone has no remote HEAD. */
async function defaultBase(root: string) {
  const remote = await git(root, 'rev-parse', '--abbrev-ref', 'origin/HEAD');
  return remote.ok ? remote.out : 'main';
}

/** Reads `.clutch/risk.yaml` and adds the patterns of each rule's guardrail list to its paths. */
async function loadRiskConfig(root: string): Promise<RiskConfig> {
  const text = await readFile(path.join(root, riskFile), 'utf-8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${riskFile} is missing. Copy it from the Clutch template.`);
    }
    throw error;
  });
  const { config, errors } = validateRiskConfig(parse(text));
  if (!config) {
    throw new Error(
      errors.map((error) => `${riskFile}: ${error.path}: ${error.message}`).join('\n'),
    );
  }
  for (const rule of config.rules) {
    if (rule.guardrails) {
      const list = JSON.parse(await readFile(path.join(root, rule.guardrails), 'utf-8')) as {
        patterns?: unknown;
      };
      if (!Array.isArray(list.patterns)) {
        throw new TypeError(`${rule.guardrails} has no patterns list.`);
      }
      rule.paths = [...(list.patterns as Array<string>), ...rule.paths];
    }
  }
  return config;
}

/**
 * The files that differ between the merge base of `base` and `head`, and
 * `head`. A rename counts as a deletion and an addition, so both paths count.
 */
async function changedFiles(root: string, base: string, head: string) {
  const out = await gitOrThrow(root, 'diff', '--name-only', '--no-renames', `${base}...${head}`);
  return out ? out.split('\n') : [];
}

async function run(args: Array<string>, cwd: string): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      base: { type: 'string' },
      head: { type: 'string', default: 'HEAD' },
      json: { type: 'boolean' },
    },
  });
  const root = await repoRoot(cwd);
  const config = await loadRiskConfig(root);
  const base = values.base ?? (await defaultBase(root));
  const files = classify(config, await changedFiles(root, base, values.head));
  const tier = changeTier(files);
  if (values.json) {
    console.log(JSON.stringify({ schemaVersion: 1, tier, base, head: values.head, files }));
    return 0;
  }
  console.log(`risk/${tier}`);
  for (const file of files.filter((candidate) => candidate.tier === tier)) {
    console.log(`  ${file.path}  (${file.pattern ?? 'unmatched'})`);
  }
  return 0;
}

/** `clutch risk`: the risk tier of the change from `--base` to `--head`, by the paths it touches. */
export async function riskCommand(args: Array<string>, cwd: string): Promise<number> {
  try {
    return await run(args, cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.includes('--json')) {
      console.log(JSON.stringify({ schemaVersion: 1, status: 'error', message }));
    } else {
      console.error(message);
    }
    return 1;
  }
}
