import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import {
  ghStack,
  ghVersion,
  pinnedGh,
  stackChain,
  stackExtensionVersion,
} from '@tools/github/stack';
import type { Run } from '@tools/github/stack';
import { conventionalProblem } from '@tools/hooks/commit-msg';
import { bumpOf, changesetDir, changesetText } from '@tools/release/changeset';

/**
 * The pull request commands that every project uses. They open each PR ready
 * for review, keep stacked PRs in one linear GitHub stack, and merge in order.
 * See .agents/skills/deliver/references/pull-requests.md.
 */
const usage = [
  'Usage: bun run pr doctor [--fix]',
  '       bun run pr open --title TEXT --body-file FILE [--base BRANCH] [--force]',
  '       bun run pr body <number> <file>',
  '       bun run pr merge <number>',
].join('\n');

const root = path.resolve(import.meta.dir, '../..');

async function must(run: Run, command: Array<string>, options?: { inherit?: boolean }) {
  const result = await run(command, options);
  if (!result.ok) {
    throw new Error(`${command.join(' ')} failed: ${result.err || result.out}`);
  }
  return result.out.trim();
}

function defaultBranch(run: Run) {
  return must(run, [
    'gh',
    'repo',
    'view',
    '--json',
    'defaultBranchRef',
    '--jq',
    '.defaultBranchRef.name',
  ]);
}

/** The open PR whose head is `branch`, with its base. */
async function prWithHead(run: Run, branch: string) {
  const out = await must(run, [
    'gh',
    'pr',
    'list',
    '--state',
    'open',
    '--head',
    branch,
    '--json',
    'number,baseRefName,url,isDraft',
  ]);
  const [found] = JSON.parse(out || '[]') as Array<{
    number: number;
    baseRefName: string;
    url: string;
    isDraft: boolean;
  }>;
  return (
    found && {
      number: found.number,
      base: found.baseRefName,
      url: found.url,
      isDraft: found.isDraft,
    }
  );
}

async function doctor(run: Run, fix: boolean) {
  const problems: Array<string> = [];
  const mise = await readFile(path.join(root, 'mise.toml'), 'utf-8');
  const pinned = pinnedGh(mise);
  const gh = await run(['gh', '--version']);
  const version = ghVersion(gh.out);
  if (!pinned) {
    problems.push('mise.toml does not pin gh. Add a line such as gh = "2.103.3" under [tools].');
  } else if (version !== pinned) {
    problems.push(
      `gh is ${version ?? 'missing'}, but mise.toml pins ${pinned}. Run: mise install, then use mise exec -- bun run pr.`,
    );
  }
  const auth = await run(['gh', 'auth', 'status']);
  if (!auth.ok) {
    problems.push('gh is not signed in. Run: gh auth login');
  }
  const extensions = await run(['gh', 'extension', 'list']);
  const installed = stackExtensionVersion(extensions.out);
  if (installed !== ghStack.version) {
    if (fix) {
      if (installed) {
        await must(run, ['gh', 'extension', 'remove', ghStack.name]);
      }
      await must(run, ['gh', 'extension', 'install', ghStack.repo, '--pin', ghStack.version]);
    } else {
      problems.push(
        `${ghStack.repo} is ${installed ?? 'not installed'}, not ${ghStack.version}. Run: bun run pr doctor --fix`,
      );
    }
  }
  for (const problem of problems) {
    console.error(problem);
  }
  if (problems.length === 0) {
    console.log(`gh ${version} and ${ghStack.repo} ${ghStack.version} are ready.`);
  }
  return problems.length === 0 ? 0 : 1;
}

async function setBody(run: Run, pr: string, file: string) {
  await must(run, [
    'gh',
    'api',
    '--method',
    'PATCH',
    `repos/{owner}/{repo}/pulls/${pr}`,
    '--field',
    `body=@${file}`,
    '--silent',
  ]);
}

/** Writes a file at a path inside the repository. Tests pass a fake. */
export type Write = (file: string, text: string) => Promise<void>;

async function writeInRepo(file: string, text: string) {
  await Bun.write(path.join(root, file), text);
}

/**
 * Adds a changeset when the branch has none: its bump comes from the
 * conventional title, and its summary is the title. Then commits it.
 */
async function ensureChangeset(
  run: Run,
  write: Write,
  base: string,
  branch: string,
  title: string,
) {
  const added = await must(run, [
    'git',
    'diff',
    '--name-only',
    '--diff-filter=A',
    `origin/${base}...HEAD`,
    '--',
    changesetDir,
  ]);
  if (added.split('\n').some((file) => file.endsWith('.md'))) {
    return;
  }
  const file = `${changesetDir}/${branch.replaceAll(/[^\w-]+/gu, '-')}.md`;
  const bump = bumpOf(title);
  await write(file, changesetText(bump, title));
  await must(run, ['git', 'add', file]);
  await must(run, [
    'git',
    'commit',
    '--quiet',
    '--message',
    `chore(changeset): add a ${bump} changeset for this PR`,
  ]);
}

async function open(
  run: Run,
  options: { title?: string; 'body-file'?: string; base?: string; force?: boolean },
  write: Write,
) {
  const { title, 'body-file': bodyFile } = options;
  if (!title || !bodyFile) {
    throw new Error(`open needs --title and --body-file.\n${usage}`);
  }
  const problem = conventionalProblem(title);
  if (problem) {
    throw new Error(`The PR title must be a conventional commit. ${problem}`);
  }
  const trunk = await defaultBranch(run);
  const branch = await must(run, ['git', 'branch', '--show-current']);
  const base = options.base ?? trunk;
  if (!branch || branch === trunk) {
    throw new Error(
      `Switch to the branch for this PR. The current branch is ${branch || 'detached'}.`,
    );
  }
  await ensureChangeset(run, write, base, branch, title);
  // After a rebase the branch needs a forced push. The lease refuses it when someone else pushed.
  const push = [
    'git',
    'push',
    '--set-upstream',
    ...(options.force ? ['--force-with-lease'] : []),
    'origin',
    'HEAD',
  ];
  const pushed = await run(push, { inherit: true });
  if (!pushed.ok) {
    throw new Error(
      options.force
        ? 'The push failed. Read the git output above.'
        : 'The push failed. Read the git output above. When a check failed, fix it. After a rebase of your own branch, run open again with --force.',
    );
  }
  const existing = await prWithHead(run, branch);
  let opened = existing;
  if (existing) {
    await setBody(run, String(existing.number), bodyFile);
  } else {
    await must(run, [
      'gh',
      'pr',
      'create',
      '--base',
      base,
      '--head',
      branch,
      '--title',
      title,
      '--body-file',
      bodyFile,
    ]);
    opened = await prWithHead(run, branch);
  }
  if (!opened) {
    throw new Error(`GitHub has no open PR for ${branch} after the create.`);
  }
  if (base === trunk) {
    if (opened.isDraft) {
      await must(run, ['gh', 'pr', 'ready', String(opened.number)]);
    }
  } else {
    const below = await stackChain(base, trunk, (head) => prWithHead(run, head));
    await must(
      run,
      ['gh', 'stack', 'link', ...below.map(String), String(opened.number), '--open'],
      { inherit: true },
    );
  }
  console.log(opened.url);
  return 0;
}

async function merge(run: Run, number: string) {
  const out = await must(run, ['gh', 'pr', 'view', number, '--json', 'baseRefName,headRefName']);
  const { baseRefName, headRefName } = JSON.parse(out) as {
    baseRefName: string;
    headRefName: string;
  };
  const trunk = await defaultBranch(run);
  const above = await must(run, [
    'gh',
    'pr',
    'list',
    '--state',
    'open',
    '--base',
    headRefName,
    '--json',
    'number',
  ]);
  const stacked = baseRefName !== trunk || (JSON.parse(above || '[]') as Array<unknown>).length > 0;
  await (stacked
    ? must(run, ['gh', 'stack', 'merge', number, '--merge', '--yes'], { inherit: true })
    : must(run, ['gh', 'pr', 'merge', number, '--merge'], { inherit: true }));
  await must(run, ['git', 'fetch', '--prune', 'origin']);
  return 0;
}

/** Runs `bun run pr <command>`. Returns the exit code. */
export async function runPr(
  args: Array<string>,
  run: Run,
  write: Write = writeInRepo,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      fix: { type: 'boolean' },
      title: { type: 'string' },
      'body-file': { type: 'string' },
      force: { type: 'boolean' },
      base: { type: 'string' },
    },
  });
  const [command, ...rest] = positionals;
  if (command === 'doctor' && rest.length === 0) {
    return doctor(run, values.fix === true);
  }
  if (command === 'open' && rest.length === 0) {
    return open(run, values, write);
  }
  if (command === 'body' && rest.length === 2) {
    await setBody(run, rest[0], rest[1]);
    return 0;
  }
  if (command === 'merge' && rest.length === 1) {
    return merge(run, rest[0]);
  }
  throw new Error(usage);
}

const spawn: Run = async (command, options) => {
  const proc = Bun.spawn(command, {
    cwd: root,
    stdout: options?.inherit ? 'inherit' : 'pipe',
    stderr: options?.inherit ? 'inherit' : 'pipe',
  });
  const [out, err, code] = await Promise.all([
    options?.inherit ? '' : new Response(proc.stdout).text(),
    options?.inherit ? '' : new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, out, err };
};

if (import.meta.main) {
  try {
    process.exit(await runPr(process.argv.slice(2), spawn));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
