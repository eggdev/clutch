import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { loadClutchConfig } from '@/clutch-config/load';
import { git, gitOrThrow } from '@/git';
import {
  changedLines,
  changeLabels,
  ownedPrefixes,
  sizeLabel,
  workspaceGlobs,
} from '@/labels/compute';

/** The workspace globs of the project's root `package.json`. None without one. */
async function workspaces(root: string) {
  const text = await readFile(path.join(root, 'package.json'), 'utf-8').catch(() => 'null');
  return workspaceGlobs(JSON.parse(text));
}

async function run(args: Array<string>, cwd: string): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      base: { type: 'string' },
      head: { type: 'string', default: 'HEAD' },
      title: { type: 'string', default: '' },
      json: { type: 'boolean' },
    },
  });
  const top = await git(cwd, 'rev-parse', '--show-toplevel');
  const root = top.ok ? top.out : cwd;
  const base = values.base ?? 'origin/HEAD';
  const out = await gitOrThrow(
    root,
    'diff',
    '--name-only',
    '--no-renames',
    `${base}...${values.head}`,
  );
  const files = out ? out.split('\n') : [];
  const labels = changeLabels(values.title, files, await workspaces(root));
  const loaded = await loadClutchConfig(root);
  const limits = (loaded.kind === 'loaded' && loaded.config.pr_size) || { warn: 300, exclude: [] };
  const numstat = await gitOrThrow(
    root,
    'diff',
    '--numstat',
    '--no-renames',
    `${base}...${values.head}`,
  );
  const lines = changedLines(numstat, limits.exclude);
  const size = sizeLabel(lines);
  labels.apply.push(size);
  labels.define.push(size);
  // A warning, never a failure: the exit code stays 0.
  const warning =
    lines > limits.warn
      ? `This change has ${lines} changed lines, more than the ${limits.warn} in pr_size.warn. Split it if a part can merge alone.`
      : null;
  if (values.json) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        owned: ownedPrefixes,
        ...labels,
        size: { lines, warn: limits.warn, warning },
      }),
    );
  } else {
    console.log(labels.apply.map((label) => label.name).join('\n'));
    if (warning) {
      console.log(`Warning: ${warning}`);
    }
  }
  return 0;
}

/** `clutch labels`: the kind and area labels of a change, from its title and its paths. */
export async function labelsCommand(args: Array<string>, cwd: string): Promise<number> {
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
