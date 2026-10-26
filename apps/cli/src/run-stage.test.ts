import { expect, test } from 'bun:test';
import { chmod } from 'node:fs/promises';
import path from 'node:path';

import { runStage } from '@apps/cli/src/run-stage';
import { fakeBin } from '@apps/cli/src/testing/fake-bin';
import { git, gitRepo } from '@apps/cli/src/testing/git-repo';

const claude = { id: 'claude', label: 'Claude Code', bin: 'claude' };
const codex = { id: 'codex', label: 'Codex', bin: 'codex' };

test('the Claude survey runs unattended in the project, and may not run any shell command it likes', async () => {
  await using bin = await fakeBin(['claude']);
  await using project = await gitRepo({});
  expect(
    await runStage({
      provider: claude,
      stage: 'survey',
      root: project.root,
      env: { PATH: bin.dir },
    }),
  ).toBe(0);

  const [call] = await bin.calls();
  expect(call.cwd).toBe(project.root);
  expect(call.args.slice(0, 2)).toEqual(['-p', '/kickoff survey']);
  expect(call.args.join(' ')).toContain('--permission-mode dontAsk');
  expect(call.args).not.toContain('Bash');
  expect(call.args.filter((arg) => arg.startsWith('Bash(') && !arg.endsWith(')'))).toEqual([]);
  expect(call.args.join(' ')).not.toContain('dangerously');
});

test('the Codex survey runs unattended in the workspace-write sandbox', async () => {
  await using bin = await fakeBin(['codex']);
  await using project = await gitRepo({});
  expect(
    await runStage({
      provider: codex,
      stage: 'survey',
      root: project.root,
      env: { PATH: bin.dir },
    }),
  ).toBe(0);

  const [call] = await bin.calls();
  expect(call.cwd).toBe(project.root);
  expect(call.args[0]).toBe('exec');
  expect(call.args.join(' ')).toContain('--sandbox workspace-write');
  expect(call.args.at(-1)).toBe('$kickoff survey');
  expect(call.args.join(' ')).not.toContain('dangerously');
});

test('the interview opens the agent chat in the project with the kickoff entry point', async () => {
  await using bin = await fakeBin(['claude', 'codex']);
  await using project = await gitRepo({});
  await runStage({
    provider: claude,
    stage: 'interview',
    root: project.root,
    env: { PATH: bin.dir },
  });
  await runStage({
    provider: codex,
    stage: 'interview',
    root: project.root,
    env: { PATH: bin.dir },
  });

  const calls = await bin.calls();
  expect(calls.map(({ name, cwd, args }) => ({ name, cwd, args }))).toEqual([
    { name: 'claude', cwd: project.root, args: ['/kickoff interview'] },
    { name: 'codex', cwd: project.root, args: ['$kickoff interview'] },
  ]);
});

test("a failed stage returns the agent's exit code", async () => {
  await using bin = await fakeBin(['claude'], { exitCode: 3 });
  await using project = await gitRepo({});
  expect(
    await runStage({
      provider: claude,
      stage: 'survey',
      root: project.root,
      env: { PATH: bin.dir },
    }),
  ).toBe(3);
});

test('the Claude migration may delete files and fix them in place, and the survey may not', async () => {
  await using bin = await fakeBin(['claude']);
  await using project = await gitRepo({});
  for (const stage of ['survey', 'migrate'] as const) {
    await runStage({ provider: claude, stage, root: project.root, env: { PATH: bin.dir } });
  }
  const [survey, migrate] = await bin.calls();
  expect(migrate.args.slice(0, 2)).toEqual(['-p', '/kickoff migrate']);
  for (const tool of ['Bash(git rm:*)', 'Bash(mise exec -- bun run format:*)']) {
    expect(survey.args).not.toContain(tool);
    expect(migrate.args).toContain(tool);
  }
  expect(migrate.args).not.toContain('Bash');
  expect(migrate.args.join(' ')).not.toContain('dangerously');
});

test('a stage commits past the Git hooks, because the gate passes only after the migration', async () => {
  await using project = await gitRepo({ 'hooks/pre-commit': '#!/bin/sh\nexit 1\n' });
  await chmod(path.join(project.root, 'hooks/pre-commit'), 0o755);
  await git(project.root, 'config', 'core.hooksPath', 'hooks');
  await using bin = await fakeBin(['claude'], {
    run: 'git commit --allow-empty --quiet -m "Survey drafts"',
  });
  for (const stage of ['survey', 'interview', 'migrate'] as const) {
    expect(
      await runStage({
        provider: claude,
        stage,
        root: project.root,
        env: { ...process.env, PATH: `${bin.dir}:${process.env.PATH}` },
      }),
    ).toBe(0);
  }
  expect(await git(project.root, 'log', '--format=%s')).toStartWith(
    'Survey drafts\nSurvey drafts\nSurvey drafts\n',
  );
});
