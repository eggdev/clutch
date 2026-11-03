import path from 'node:path';
import { parseArgs } from 'node:util';

import { autoMerged } from '@tools/github/auto-revert';
import type { Run } from '@tools/github/stack';
import { changesetDir, changesetText, packageName } from '@tools/release/changeset';

/**
 * Reverts a merged pull request on a `revert/<number>` branch and opens the
 * revert PR. The Revert workflow runs it when someone adds the `revert` label
 * to a merged PR. It pushes and opens the PR with the token in `PUSH_TOKEN` and
 * `GH_TOKEN`, the release bot's, so CI runs on the revert PR. See
 * https://github.com/eggdev/clutch/blob/main/docs/contributing/operations/rollback.md#revert-a-merged-pull-request.
 *
 * When auto-merge merged the reverted PR, it also files a `risk-tighten` issue
 * that lists the PR's files and their risk tiers, and proposes to tighten the
 * path that broke. It files the issue with `ISSUE_TOKEN`, the workflow's own
 * token, because the release bot has no Issues permission.
 */
const usage =
  'Usage: bun tools/github/revert.ts --pr <number> --sha <merge commit> --title <title> --base <branch>';

const root = path.resolve(import.meta.dir, '../..');

/** The commit-msg hook's limit on the first line. */
const maxLength = 72;

/** The conventional title of the revert: `revert: <original title>`, cut to fit one line. */
export function revertTitle(title: string) {
  const full = `revert: ${title}`;
  return full.length <= maxLength ? full : `${full.slice(0, maxLength - 3).trimEnd()}...`;
}

export type Write = (file: string, text: string) => Promise<void>;

const writeFile: Write = async (file, text) => {
  await Bun.write(file, text);
};

async function must(run: Run, command: Array<string>, env?: Record<string, string>) {
  const result = await run(command, env ? { env } : undefined);
  if (!result.ok) {
    throw new Error(`${command.join(' ')} failed: ${result.err || result.out}`);
  }
  return result.out.trim();
}

/** The label of the issues that propose to tighten a risk path after a revert. */
export const tightenLabel = 'risk-tighten';

type RiskFile = { path: string; tier: string; pattern?: string };

/** The body of the issue that proposes to tighten the path of an auto-merged PR that was reverted. */
export function tightenBody(pr: string, url: string, files: Array<RiskFile>) {
  return [
    `Auto-merge merged #${pr}, and it was reverted in ${url}. Its files and their risk tiers:`,
    '',
    ...files.map((file) => `- \`${file.path}\`: ${file.tier} (${file.pattern ?? 'unmatched'})`),
    '',
    'If one of these paths caused the break, tighten it: add it to a one-way-door rule in `.clutch/risk.yaml`, or add a check that catches the break. If the path did not cause it, such as a flaky test, close this issue with the reason.',
    '',
    'See https://github.com/eggdev/clutch/blob/main/docs/contributing/operations/rollback.md#tighten-after-a-revert.',
  ].join('\n');
}

async function fileTightenIssue(
  run: Run,
  { pr, sha, url }: { pr: string; sha: string; url: string },
  token?: string,
) {
  const risk = JSON.parse(
    await must(run, [
      'bun',
      'tools/clutch.ts',
      'risk',
      '--base',
      `${sha}^1`,
      '--head',
      sha,
      '--json',
    ]),
  ) as { files?: Array<RiskFile> };
  const env = token ? { GH_TOKEN: token } : undefined;
  await must(run, ['gh', 'label', 'create', tightenLabel, '--force', '--color', 'd93f0b'], env);
  return must(
    run,
    [
      'gh',
      'issue',
      'create',
      '--title',
      `Tighten risk? #${pr} was reverted after auto-merge`,
      '--label',
      tightenLabel,
      '--body',
      tightenBody(pr, url, risk.files ?? []),
    ],
    env,
  );
}

/** Runs the revert. Returns the exit code. */
export async function runRevert(
  args: Array<string>,
  run: Run,
  options: {
    write?: Write;
    log?: (text: string) => void;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<number> {
  const { write = writeFile, log = console.log } = options;
  const env = options.env ?? process.env;
  const { values } = parseArgs({
    args,
    options: {
      pr: { type: 'string' },
      sha: { type: 'string' },
      title: { type: 'string' },
      base: { type: 'string' },
    },
  });
  const { pr, sha, title, base } = values;
  if (!pr || !sha || !title || !base) {
    throw new Error(usage);
  }
  const branch = `revert/${pr}`;
  const existing = await run(['git', 'ls-remote', '--exit-code', '--heads', 'origin', branch]);
  if (existing.ok) {
    log(`${branch} already exists. Its revert PR is open or done.`);
    return 0;
  }
  await must(run, ['git', 'switch', '--create', branch, `origin/${base}`]);
  // A merge commit names its first parent, the base, as the side to keep.
  const commit = await must(run, ['git', 'rev-list', '--parents', '-n', '1', sha]);
  const parents = commit.split(' ');
  const mainline = parents.length > 2 ? ['-m', '1'] : [];
  const reverted = await run(['git', 'revert', '--no-commit', ...mainline, sha]);
  if (!reverted.ok) {
    await run(['git', 'revert', '--abort']);
    await must(run, [
      'gh',
      'pr',
      'comment',
      pr,
      '--body',
      `The \`revert\` label could not revert ${sha.slice(0, 7)} cleanly: a later change touches the same lines. Revert it by hand, or fix forward.`,
    ]);
    log(`The revert of #${pr} conflicts. Commented on the PR.`);
    return 1;
  }
  const subject = revertTitle(title);
  const changeset = path.join(changesetDir, `revert-${pr}.md`);
  await write(path.join(root, changeset), changesetText(await packageName(root), 'patch', subject));
  await must(run, ['git', 'add', '--all']);
  await must(run, [
    'git',
    'commit',
    '--message',
    `${subject}\n\nThis reverts #${pr}, merge commit ${sha}.`,
  ]);
  const repo = env.GITHUB_REPOSITORY;
  const remote =
    repo && env.PUSH_TOKEN
      ? `https://x-access-token:${env.PUSH_TOKEN}@github.com/${repo}.git`
      : 'origin';
  await must(run, ['git', 'push', remote, `HEAD:refs/heads/${branch}`]);
  const url = await must(run, [
    'gh',
    'pr',
    'create',
    '--base',
    base,
    '--head',
    branch,
    '--title',
    subject,
    '--body',
    `Reverts #${pr} (merge commit ${sha}). Someone added the \`revert\` label to it.\n\nWhen auto-merge merged the original PR and this revert is low or medium risk, auto-merge takes it once its checks pass. Otherwise, a person merges it.`,
  ]);
  await must(run, [
    'gh',
    'pr',
    'comment',
    pr,
    '--body',
    `Reverted in ${url}. Reply here with the reason for the revert, so the next change avoids it.`,
  ]);
  log(`Opened ${url}.`);
  if (repo && (await autoMerged(run, repo, pr))) {
    const issue = await fileTightenIssue(run, { pr, sha, url }, env.ISSUE_TOKEN);
    log(`Auto-merge merged #${pr}. Filed ${issue} to tighten its path.`);
  }
  return 0;
}

const spawn: Run = async (command, options) => {
  const env = options?.env ? { ...process.env, ...options.env } : undefined;
  const proc = Bun.spawn(command, { cwd: root, env, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, out, err };
};

if (import.meta.main) {
  try {
    process.exit(await runRevert(process.argv.slice(2), spawn));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
