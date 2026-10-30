import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { git, gitOrThrow } from '@/git';
import { changeLabels, ownedPrefixes, workspaceGlobs } from '@/labels/compute';

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
  if (values.json) {
    console.log(JSON.stringify({ schemaVersion: 1, owned: ownedPrefixes, ...labels }));
  } else {
    console.log(labels.apply.map((label) => label.name).join('\n'));
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
