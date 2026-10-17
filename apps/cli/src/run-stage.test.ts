import { expect, test } from 'bun:test';

import { runStage } from '@apps/cli/src/run-stage';
import { fakeBin } from '@apps/cli/src/testing/fake-bin';
import { gitRepo } from '@apps/cli/src/testing/git-repo';

const claude = { id: 'claude', label: 'Claude Code', bin: 'claude' };
const codex = { id: 'codex', label: 'Codex', bin: 'codex' };

test('the Claude survey runs unattended in the worktree, and may not run any shell command it likes', async () => {
  await using bin = await fakeBin(['claude']);
  await using worktree = await gitRepo({});
  expect(
    await runStage({
      provider: claude,
      stage: 'survey',
      worktree: worktree.root,
      env: { PATH: bin.dir },
    }),
  ).toBe(0);

  const [call] = await bin.calls();
  expect(call.cwd).toBe(worktree.root);
  expect(call.args.slice(0, 2)).toEqual(['-p', '/kickoff survey']);
  expect(call.args.join(' ')).toContain('--permission-mode dontAsk');
  expect(call.args).not.toContain('Bash');
  expect(call.args.filter((arg) => arg.startsWith('Bash(') && !arg.endsWith(')'))).toEqual([]);
  expect(call.args.join(' ')).not.toContain('dangerously');
});

test('the Codex survey runs unattended in the workspace-write sandbox', async () => {
  await using bin = await fakeBin(['codex']);
  await using worktree = await gitRepo({});
  expect(
    await runStage({
      provider: codex,
      stage: 'survey',
      worktree: worktree.root,
      env: { PATH: bin.dir },
    }),
  ).toBe(0);

  const [call] = await bin.calls();
  expect(call.cwd).toBe(worktree.root);
  expect(call.args[0]).toBe('exec');
  expect(call.args.join(' ')).toContain('--sandbox workspace-write');
  expect(call.args.at(-1)).toBe('$kickoff survey');
  expect(call.args.join(' ')).not.toContain('dangerously');
});

test('the interview opens the agent chat in the worktree with the kickoff entry point', async () => {
  await using bin = await fakeBin(['claude', 'codex']);
  await using worktree = await gitRepo({});
  await runStage({
    provider: claude,
    stage: 'interview',
    worktree: worktree.root,
    env: { PATH: bin.dir },
  });
  await runStage({
    provider: codex,
    stage: 'interview',
    worktree: worktree.root,
    env: { PATH: bin.dir },
  });

  const calls = await bin.calls();
  expect(calls.map(({ name, cwd, args }) => ({ name, cwd, args }))).toEqual([
    { name: 'claude', cwd: worktree.root, args: ['/kickoff'] },
    { name: 'codex', cwd: worktree.root, args: ['$kickoff'] },
  ]);
});

test("a failed stage returns the agent's exit code", async () => {
  await using bin = await fakeBin(['claude'], { exitCode: 3 });
  await using worktree = await gitRepo({});
  expect(
    await runStage({
      provider: claude,
      stage: 'survey',
      worktree: worktree.root,
      env: { PATH: bin.dir },
    }),
  ).toBe(3);
});
