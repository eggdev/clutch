import { parseArgs } from 'node:util';

import { git } from '@/git';
import { nextCounts } from '@/ratchet/compare';
import { ratchetsFile, readRatchets, writeRatchets } from '@/ratchet/config';
import type { Ratchet } from '@/ratchet/config';
import { checkRatchet, countNow } from '@/ratchet/count';

const usage =
  'Usage: clutch ratchet check [--base REF] [--json]\n       clutch ratchet update\n       clutch ratchet add <name> (--pattern REGEX | --command CMD) --files GLOB';

/** The repository that holds `cwd`, or `cwd` when it is not in one. */
async function repoRoot(cwd: string) {
  const top = await git(cwd, 'rev-parse', '--show-toplevel');
  return top.ok ? top.out : cwd;
}

/**
 * The merge base to compare touched files with: `--base`, then `CHECK_BASE`
 * as CI sets it, then the merge base with the remote default branch. An
 * all-zero base, as on a new branch, has none.
 */
async function mergeBase(root: string, given?: string) {
  const ref = given ?? process.env.CHECK_BASE;
  if (ref && /^0+$/u.test(ref)) {
    return null;
  }
  for (const candidate of ref ? [ref] : ['origin/HEAD', 'origin/main']) {
    const base = await git(root, 'merge-base', candidate, 'HEAD');
    if (base.ok) {
      return base.out;
    }
  }
  return null;
}

async function check(root: string, base: string | null, json: boolean) {
  const { ratchets } = await readRatchets(root);
  let code = 0;
  const report: Record<string, unknown> = {};
  for (const [name, ratchet] of Object.entries(ratchets)) {
    const result = await checkRatchet(root, ratchet, base);
    report[name] = result;
    if (result.code === 1) {
      code = 1;
    } else if (result.code === 2 && code === 0) {
      code = 2;
    }
    if (!json) {
      for (const item of result.raised) {
        console.log(
          `${name}: ${item.path} has ${item.to}, more than ${item.from} in the ${item.against === 'base' ? 'merge base' : 'baseline'}. Fix the new violation.`,
        );
      }
      for (const item of result.dropped) {
        console.log(
          `${name}: ${item.path} dropped from ${item.from} to ${item.to}. Run clutch ratchet update to lower ${ratchetsFile}.`,
        );
      }
    }
  }
  if (json) {
    console.log(JSON.stringify({ schemaVersion: 1, base, code, ratchets: report }));
  } else {
    console.log(`clutch ratchet check: ${Object.keys(ratchets).length} ratchets, exit ${code}.`);
  }
  return code;
}

async function update(root: string) {
  const file = await readRatchets(root);
  for (const ratchet of Object.values(file.ratchets)) {
    ratchet.counts = nextCounts(ratchet, await countNow(root, ratchet));
  }
  await writeRatchets(root, file);
  console.log(`${ratchetsFile} records the counts now. Commit it with the fix.`);
  return 0;
}

async function add(
  root: string,
  name: string,
  values: { pattern?: string; command?: string; files?: string },
) {
  const file = await readRatchets(root);
  if (file.ratchets[name]) {
    throw new Error(`${ratchetsFile} already has a ratchet named ${name}.`);
  }
  if (!values.files || Boolean(values.pattern) === Boolean(values.command)) {
    throw new Error(usage);
  }
  const ratchet: Ratchet = {
    ...(values.pattern ? { pattern: values.pattern } : { command: values.command }),
    files: values.files,
    counts: {},
  };
  // A new ratchet starts at the counts today. They may only go down from here.
  ratchet.counts = await countNow(root, ratchet);
  file.ratchets[name] = ratchet;
  await writeRatchets(root, file);
  const total = Object.values(ratchet.counts).reduce(
    (sum: number, count: number) => sum + count,
    0,
  );
  console.log(`${name} counts ${total} in ${Object.keys(ratchet.counts).length} files.`);
  return 0;
}

async function run(args: Array<string>, cwd: string) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      base: { type: 'string' },
      json: { type: 'boolean' },
      pattern: { type: 'string' },
      command: { type: 'string' },
      files: { type: 'string' },
    },
  });
  const root = await repoRoot(cwd);
  const [action, name] = positionals;
  if (action === 'check' && positionals.length === 1) {
    return check(root, await mergeBase(root, values.base), values.json === true);
  }
  if (action === 'update' && positionals.length === 1) {
    return update(root);
  }
  if (action === 'add' && name && positionals.length === 2) {
    return add(root, name, values);
  }
  throw new Error(usage);
}

/** `clutch ratchet`: shrink-only counts of old violations. See decision 0001. */
export async function ratchetCommand(args: Array<string>, cwd: string): Promise<number> {
  try {
    return await run(args, cwd);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
