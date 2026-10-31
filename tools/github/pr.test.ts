import { expect, test } from 'bun:test';

import { runPr, usage } from '@tools/github/pr';
import type { Result, Run } from '@tools/github/stack';
import { allowConsole } from '@tools/testing/console-guard';

/** A fake runner. It answers each command from `answers` by prefix and records the calls. */
function fake(answers: Array<[string, Partial<Result>]>) {
  const calls: Array<string> = [];
  const run: Run = (command) => {
    const line = command.join(' ');
    calls.push(line);
    const answer = answers.find(([prefix]) => line.startsWith(prefix))?.[1] ?? {};
    return Promise.resolve({ ok: true, out: '', err: '', ...answer });
  };
  return { run, calls };
}

/** A fake writer that records each file instead of writing it. */
const written: Array<string> = [];
const noWrite = (file: string) => {
  written.push(file);
  return Promise.resolve();
};

const trunk: [string, Partial<Result>] = ['gh repo view', { out: 'main\n' }];

test('open on the default branch base creates a ready PR and links no stack', async () => {
  const gh = fake([
    trunk,
    ['git branch --show-current', { out: 'cl-024\n' }],
    ['gh pr list --state open --head cl-024', { out: '[]' }],
  ]);
  let created = false;
  const run: Run = (command, options) => {
    const line = command.join(' ');
    if (line.startsWith('gh pr create')) {
      created = true;
    }
    if (created && line.startsWith('gh pr list --state open --head cl-024')) {
      return Promise.resolve({
        ok: true,
        out: '[{"number":12,"baseRefName":"main","url":"https://github.com/o/r/pull/12","isDraft":false}]',
        err: '',
      });
    }
    return gh.run(command, options);
  };
  expect(
    await runPr(['open', '--title', 'feat: add it', '--body-file', 'body.md'], run, noWrite),
  ).toBe(0);
  expect(gh.calls).toContain('git push --set-upstream origin HEAD');
  expect(gh.calls).toContain(
    'gh pr create --base main --head cl-024 --title feat: add it --body-file body.md',
  );
  expect(gh.calls.some((call) => call.startsWith('gh stack'))).toBe(false);
  expect(gh.calls.some((call) => call.includes('--draft'))).toBe(false);
});

test('open on a stacked base reuses the open PR and links the whole chain', async () => {
  const gh = fake([
    trunk,
    ['git branch --show-current', { out: 'cl-024\n' }],
    [
      'gh pr list --state open --head cl-024',
      {
        out: '[{"number":12,"baseRefName":"cl-007","url":"https://github.com/o/r/pull/12","isDraft":true}]',
      },
    ],
    [
      'gh pr list --state open --head cl-007',
      { out: '[{"number":10,"baseRefName":"cl-003","url":"u","isDraft":false}]' },
    ],
    [
      'gh pr list --state open --head cl-003',
      { out: '[{"number":8,"baseRefName":"main","url":"u","isDraft":false}]' },
    ],
  ]);
  expect(
    await runPr(
      ['open', '--title', 'feat: add it', '--body-file', 'body.md', '--base', 'cl-007'],
      gh.run,
      noWrite,
    ),
  ).toBe(0);
  expect(gh.calls).toContain(
    'gh api --method PATCH repos/{owner}/{repo}/pulls/12 --field body=@body.md --silent',
  );
  expect(gh.calls.some((call) => call.startsWith('gh pr create'))).toBe(false);
  expect(gh.calls.at(-1)).toBe('gh stack link 8 10 12 --open');
});

test('merge uses gh stack for a PR in a stack, and gh pr merge for a lone PR', async () => {
  const clock = { now: () => 0, sleep: () => Promise.resolve() };
  const released = [
    'gh run list',
    { out: '[{"headSha":"m","status":"completed","conclusion":"success","url":"u"}]' },
  ] as [string, Partial<Result>];
  const stacked = fake([
    trunk,
    ['gh pr view 10 --json mergeCommit', { out: 'm' }],
    ['gh pr view 10', { out: '{"baseRefName":"cl-004","headRefName":"cl-007"}' }],
    ['gh pr list --state open --base cl-007', { out: '[]' }],
    released,
    ['git show', { out: '{"version":"1.0.0"}' }],
  ]);
  await runPr(['merge', '10'], stacked.run, noWrite, clock);
  expect(stacked.calls).toContain('gh stack merge 10 --merge --yes');

  const lone = fake([
    trunk,
    ['gh pr view 12 --json mergeCommit', { out: 'm' }],
    ['gh pr view 12', { out: '{"baseRefName":"main","headRefName":"cl-024"}' }],
    ['gh pr list --state open --base cl-024', { out: '[]' }],
    released,
    ['git show', { out: '{"version":"1.0.0"}' }],
  ]);
  await runPr(['merge', '12'], lone.run, noWrite, clock);
  // The fetch runs right after the merge, before the release wait.
  const merged = lone.calls.indexOf('gh pr merge 12 --merge');
  expect(merged).not.toBe(-1);
  expect(lone.calls[merged + 1]).toBe('git fetch --prune origin');
  expect(lone.calls.at(-1)).toBe('git show origin/main:package.json');
});

test('doctor reports a gh that does not match mise.toml, and --fix installs the pinned extension', async () => {
  const old = fake([
    ['gh --version', { out: 'gh version 2.45.0 (2026-03-17)' }],
    ['gh extension list', { out: '' }],
  ]);
  allowConsole(
    'error',
    'gh is 2.45.0, but mise.toml pins 2.103.3. Run: mise install, then use mise exec -- bun run pr.',
  );
  allowConsole(
    'error',
    'github/gh-stack is not installed, not v0.3.0. Run: bun run pr doctor --fix',
  );
  expect(await runPr(['doctor'], old.run, noWrite)).toBe(1);

  const fixable = fake([
    ['gh --version', { out: 'gh version 2.103.3 (2026-10-26)' }],
    ['gh extension list', { out: 'gh stack\tgithub/gh-stack\tv0.2.1' }],
  ]);
  expect(await runPr(['doctor', '--fix'], fixable.run, noWrite)).toBe(0);
  expect(fixable.calls).toContain('gh extension remove gh-stack');
  expect(fixable.calls).toContain('gh extension install github/gh-stack --pin v0.3.0');
});

test('--help prints the usage, runs no command and exits 0', async () => {
  const gh = fake([]);
  expect(await runPr(['--help'], gh.run, noWrite)).toBe(0);
  expect(gh.calls).toEqual([]);
  expect(usage).toContain('bun run pr merge <number>');
});

test('a wrong command or missing flag gives the usage', async () => {
  const gh = fake([]);
  await expect(runPr(['close', '1'], gh.run, noWrite)).rejects.toThrow('Usage: bun run pr');
  await expect(runPr(['open', '--title', 'fix: x'], gh.run, noWrite)).rejects.toThrow(
    'open needs --title and --body-file',
  );
});

test('a rejected push names --force, and --force pushes with a lease', async () => {
  const rejected = fake([
    trunk,
    ['git branch --show-current', { out: 'cl-024\n' }],
    ['git push', { ok: false }],
  ]);
  await expect(
    runPr(['open', '--title', 'fix: x', '--body-file', 'b.md'], rejected.run, noWrite),
  ).rejects.toThrow('run open again with --force');

  const forced = fake([
    trunk,
    ['git branch --show-current', { out: 'cl-024\n' }],
    [
      'gh pr list --state open --head cl-024',
      { out: '[{"number":12,"baseRefName":"main","url":"u","isDraft":false}]' },
    ],
  ]);
  expect(
    await runPr(
      ['open', '--title', 'fix: x', '--body-file', 'b.md', '--force'],
      forced.run,
      noWrite,
    ),
  ).toBe(0);
  expect(forced.calls).toContain('git push --set-upstream --force-with-lease origin HEAD');
});

test('open refuses a PR title that is not a conventional commit', async () => {
  const gh = fake([trunk]);
  await expect(
    runPr(['open', '--title', 'Add it', '--body-file', 'b.md'], gh.run, noWrite),
  ).rejects.toThrow('The PR title must be a conventional commit.');
  expect(gh.calls).toEqual([]);
});

test('open adds a changeset from the title when the branch has none, and keeps an existing one', async () => {
  written.length = 0;
  const bare = fake([
    trunk,
    ['git branch --show-current', { out: 'cl-032\n' }],
    ['git diff --name-only --diff-filter=A', { out: '' }],
    [
      'gh pr list --state open --head cl-032',
      { out: '[{"number":40,"baseRefName":"main","url":"u","isDraft":false}]' },
    ],
  ]);
  await runPr(
    ['open', '--title', 'feat(release): add changesets', '--body-file', 'b.md'],
    bare.run,
    noWrite,
  );
  expect(written).toEqual(['.changeset/cl-032.md']);
  expect(bare.calls).toContain('git add .changeset/cl-032.md');
  expect(bare.calls).toContain(
    'git commit --quiet --message chore(changeset): add a minor changeset for this PR -- .changeset/cl-032.md',
  );

  written.length = 0;
  const ready = fake([
    trunk,
    ['git branch --show-current', { out: 'cl-032\n' }],
    ['git diff --name-only --diff-filter=A', { out: '.changeset/cl-032.md\n' }],
    [
      'gh pr list --state open --head cl-032',
      { out: '[{"number":40,"baseRefName":"main","url":"u","isDraft":false}]' },
    ],
  ]);
  await runPr(['open', '--title', 'fix: x', '--body-file', 'b.md'], ready.run, noWrite);
  expect(written).toEqual([]);
});

test('an added .changeset/README.md is not a changeset', async () => {
  written.length = 0;
  const gh = fake([
    trunk,
    ['git branch --show-current', { out: 'cl-032b\n' }],
    ['git diff --name-only --diff-filter=A', { out: '.changeset/README.md\n' }],
    [
      'gh pr list --state open --head cl-032b',
      { out: '[{"number":39,"baseRefName":"main","url":"u","isDraft":false}]' },
    ],
  ]);
  await runPr(['open', '--title', 'feat: add it', '--body-file', 'b.md'], gh.run, noWrite);
  expect(written).toEqual(['.changeset/cl-032b.md']);
});

const clock = { now: () => 0, sleep: () => Promise.resolve() };
const botSetUp: Array<[string, Partial<Result>]> = [
  ['gh api repos/{owner}/{repo}/actions/variables/CLUTCH_APP_ID', { out: '42\n' }],
  ['gh api repos/{owner}/{repo}/contents/.github/workflows/open-pr.yml?ref=main', {}],
];

test('open asks the Open PR workflow on main to open the PR as the bot, then sets the body', async () => {
  const gh = fake([trunk, ['git branch --show-current', { out: 'cl-024\n' }], ...botSetUp]);
  let dispatched = false;
  const run: Run = (command, options) => {
    const line = command.join(' ');
    if (line.startsWith('gh workflow run open-pr.yml')) {
      dispatched = true;
    }
    if (line.startsWith('gh pr list --state open --head cl-024')) {
      gh.calls.push(line);
      return Promise.resolve({
        ok: true,
        out: dispatched
          ? '[{"number":12,"baseRefName":"main","url":"https://github.com/o/r/pull/12","isDraft":false}]'
          : '[]',
        err: '',
      });
    }
    return gh.run(command, options);
  };
  expect(
    await runPr(['open', '--title', 'feat: add it', '--body-file', 'body.md'], run, noWrite, clock),
  ).toBe(0);
  expect(gh.calls).toContain(
    'gh workflow run open-pr.yml --ref main -f head=cl-024 -f base=main -f title=feat: add it',
  );
  expect(gh.calls).toContain(
    'gh api --method PATCH repos/{owner}/{repo}/pulls/12 --field body=@body.md --silent',
  );
  expect(gh.calls.some((call) => call.startsWith('gh pr create'))).toBe(false);
});

test('open falls back to the user when the bot opens no PR in time', async () => {
  let now = 0;
  const ticking = {
    now: () => now,
    sleep: (ms: number) => {
      now += ms;
      return Promise.resolve();
    },
  };
  const gh = fake([
    trunk,
    ['git branch --show-current', { out: 'cl-024\n' }],
    ...botSetUp,
    ['gh run list --workflow open-pr.yml', { out: 'https://github.com/o/r/actions/runs/9\n' }],
  ]);
  let created = false;
  const run: Run = (command, options) => {
    const line = command.join(' ');
    if (line.startsWith('gh pr create')) {
      created = true;
    }
    if (line.startsWith('gh pr list --state open --head cl-024')) {
      gh.calls.push(line);
      return Promise.resolve({
        ok: true,
        out: created ? '[{"number":13,"baseRefName":"main","url":"u","isDraft":false}]' : '[]',
        err: '',
      });
    }
    return gh.run(command, options);
  };
  expect(
    await runPr(['open', '--title', 'fix: x', '--body-file', 'body.md'], run, noWrite, ticking),
  ).toBe(0);
  expect(gh.calls.some((call) => call.startsWith('gh workflow run open-pr.yml'))).toBe(true);
  expect(gh.calls).toContain(
    'gh pr create --base main --head cl-024 --title fix: x --body-file body.md',
  );
});

test('merge refuses while GitHub wants a review, and names who must review', async () => {
  const pending = fake([
    trunk,
    [
      'gh pr view 14',
      {
        out: JSON.stringify({
          baseRefName: 'main',
          headRefName: 'cl-024',
          reviewDecision: 'REVIEW_REQUIRED',
          reviewRequests: [{ login: 'eggdev' }, { slug: 'core' }],
          latestReviews: [],
        }),
      },
    ],
  ]);
  await expect(runPr(['merge', '14'], pending.run, noWrite, clock)).rejects.toThrow(
    '#14 needs an approving review from @eggdev, the core team before it merges.',
  );
  expect(pending.calls.some((call) => call.startsWith('gh pr merge'))).toBe(false);
  const changes = fake([
    trunk,
    [
      'gh pr view 15',
      {
        out: JSON.stringify({
          baseRefName: 'main',
          headRefName: 'cl-025',
          reviewDecision: 'CHANGES_REQUESTED',
          reviewRequests: [],
          latestReviews: [{ author: { login: 'eggdev' }, state: 'CHANGES_REQUESTED' }],
        }),
      },
    ],
  ]);
  await expect(runPr(['merge', '15'], changes.run, noWrite, clock)).rejects.toThrow(
    '#15 has changes requested by @eggdev.',
  );
});
