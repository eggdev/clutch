import { expect, test } from 'bun:test';

import { runPr } from '@tools/github/pr';
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
  const stacked = fake([
    trunk,
    ['gh pr view 10', { out: '{"baseRefName":"cl-004","headRefName":"cl-007"}' }],
    ['gh pr list --state open --base cl-007', { out: '[]' }],
  ]);
  await runPr(['merge', '10'], stacked.run, noWrite);
  expect(stacked.calls).toContain('gh stack merge 10 --merge --yes');

  const lone = fake([
    trunk,
    ['gh pr view 12', { out: '{"baseRefName":"main","headRefName":"cl-024"}' }],
    ['gh pr list --state open --base cl-024', { out: '[]' }],
  ]);
  await runPr(['merge', '12'], lone.run, noWrite);
  expect(lone.calls).toContain('gh pr merge 12 --merge');
  expect(lone.calls.at(-1)).toBe('git fetch --prune origin');
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
    'git commit --quiet --message chore(changeset): add a minor changeset for this PR',
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
