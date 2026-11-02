import path from 'node:path';
import { parseArgs } from 'node:util';

import { appendEntry, frictionFile, readEntries, since } from '@/friction/log';
import type { FrictionKind } from '@/friction/log';
import { git } from '@/git';

/** The checkout that holds `cwd`. A task checkout keeps its own log, and its PR commits it. */
async function checkoutRoot(cwd: string) {
  const top = await git(cwd, 'rev-parse', '--show-toplevel');
  return top.ok ? top.out : cwd;
}

async function run(args: Array<string>, cwd: string, now: Date): Promise<number> {
  const [action, ...rest] = args;
  const root = await checkoutRoot(cwd);
  if (action === 'add') {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        issue: { type: 'string' },
        kind: { type: 'string', default: 'tooling' },
        file: { type: 'string' },
      },
    });
    const file = path.resolve(root, values.file ?? frictionFile);
    const branch = await git(root, 'branch', '--show-current');
    const entry = {
      at: now.toISOString(),
      issue: values.issue ?? null,
      kind: values.kind as FrictionKind,
      text: positionals.join(' '),
      branch: branch.ok && branch.out ? branch.out : null,
    };
    await appendEntry(file, entry);
    console.log(`Added to ${path.relative(root, file)}: ${entry.kind}: ${entry.text}`);
    return 0;
  }
  if (action === 'list') {
    const { values } = parseArgs({
      args: rest,
      options: {
        since: { type: 'string' },
        json: { type: 'boolean' },
        file: { type: 'string' },
      },
    });
    const all = await readEntries(path.resolve(root, values.file ?? frictionFile));
    const entries = values.since ? since(all, values.since, now) : all;
    if (values.json) {
      console.log(JSON.stringify(entries, null, 2));
    } else if (entries.length === 0) {
      console.log('No friction entries.');
    } else {
      for (const entry of entries) {
        console.log(`${entry.at}  ${entry.kind}  ${entry.issue ?? '-'}  ${entry.text}`);
      }
    }
    return 0;
  }
  throw new Error(
    'Run clutch friction add "<text>" [--issue CL-NNN] [--kind tooling|docs|check|flake], or clutch friction list [--since 7d] [--json].',
  );
}

/** `clutch friction`: record what slowed a task down, and list it for the weekly gardening pass. */
export async function frictionCommand(
  args: Array<string>,
  cwd: string,
  now = new Date(),
): Promise<number> {
  try {
    return await run(args, cwd, now);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}
