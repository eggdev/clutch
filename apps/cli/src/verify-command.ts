import { parseArgs } from 'node:util';

import { originRepo, runGh } from '@/doctor/remote';
import type { Gh } from '@/doctor/remote';
import { postShots } from '@/verify/post';

export type VerifyDeps = { gh?: Gh };

async function run(args: Array<string>, cwd: string, deps: VerifyDeps) {
  const [sub, ...rest] = args;
  if (sub !== 'post') {
    throw new Error('Usage: clutch verify post --pr <number> <png>...');
  }
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      pr: { type: 'string' },
      repo: { type: 'string' },
      head: { type: 'string' },
      note: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });
  const pr = Number(values.pr);
  if (!/^\d+$/u.test(values.pr ?? '') || pr < 1) {
    throw new Error('--pr takes the number of a pull request.');
  }
  if (values.head !== undefined && !/^[0-9a-f]{40}$/u.test(values.head)) {
    throw new Error('--head takes a full 40-character commit SHA.');
  }
  const repo = values.repo ?? (await originRepo(cwd));
  if (!repo) {
    throw new Error('No GitHub origin remote. Pass --repo OWNER/NAME.');
  }
  const result = await postShots({
    gh: deps.gh ?? runGh,
    repo,
    pr,
    files: positionals,
    head: values.head,
    note: values.note,
  });
  if (values.json) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        status: 'posted',
        repo,
        pr,
        ...result,
      }),
    );
    return 0;
  }
  for (const image of result.images) {
    console.log(`${image.name}: ${image.url}`);
  }
  console.log(
    `${result.comment.edited ? 'Edited' : 'Posted'} ${result.comment.url} (head ${result.head.slice(0, 7)})`,
  );
  return 0;
}

/**
 * `clutch verify post --pr <n> <png>...`: commits the screenshots of a verify
 * run to the `verify-shots` branch and posts or edits the PR's one verify
 * comment. It exits 0 when the comment is up, and 1 on any failure.
 */
export async function verifyCommand(
  args: Array<string>,
  cwd: string,
  deps: VerifyDeps = {},
): Promise<number> {
  try {
    return await run(args, cwd, deps);
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
