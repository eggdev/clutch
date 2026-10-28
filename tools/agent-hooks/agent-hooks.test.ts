import { expect, test } from 'bun:test';
import path from 'node:path';

import { afterEdit } from '@tools/agent-hooks/after-edit';
import { endOfTurn } from '@tools/agent-hooks/end-of-turn';
import { guardGuardrails, guardrailList } from '@tools/agent-hooks/guard-guardrails';
import { editedFiles } from '@tools/agent-hooks/payload';
import type { Run } from '@tools/agent-hooks/payload';
import { inRepo } from '@tools/testing/in-repo';

const repo = path.resolve(import.meta.dir, '../..');
const list = JSON.stringify({ patterns: ['oxlint.config.ts', 'tools/lint/**'] });

/** The hook-specific part of a hook's JSON answer. */
const decision = (stdout = '') => JSON.parse(stdout).hookSpecificOutput;

/** A runner that records each command and answers from `answers`, in order. */
function fakeRunner(answers: Array<{ exitCode: number; output: string }>) {
  const commands: Array<string> = [];
  const runner: Run = (command) => {
    commands.push([path.basename(command[0]), ...command.slice(1)].join(' '));
    return answers.shift() ?? { exitCode: 0, output: '' };
  };
  return { commands, runner };
}

test('edited files come from Claude Code file paths and Codex patches, inside the repository only', () => {
  expect(
    editedFiles({ tool_name: 'Write', tool_input: { file_path: '/repo/tools/a.ts' } }, '/repo'),
  ).toEqual(['tools/a.ts']);
  const patch = [
    '*** Begin Patch',
    '*** Add File: tools/new.ts',
    '*** Update File: oxlint.config.ts',
    '*** Move to: tools/moved.ts',
    '*** Delete File: tools/old.ts',
    '*** End Patch',
  ].join('\n');
  expect(
    editedFiles(
      { tool_name: 'apply_patch', tool_input: { command: patch }, cwd: '/repo' },
      '/repo',
    ),
  ).toEqual(['tools/new.ts', 'oxlint.config.ts', 'tools/moved.ts', 'tools/old.ts']);
  expect(
    editedFiles({ tool_name: 'Edit', tool_input: { file_path: '/elsewhere/x.ts' } }, '/repo'),
  ).toEqual([]);
});

test('a guardrail edit asks in Claude Code and is refused in Codex, only after kickoff', async () => {
  const payload = { tool_name: 'Edit', tool_input: { file_path: 'tools/lint/class-policy.mjs' } };
  const during = await inRepo({ [guardrailList]: list, 'KICKOFF.md': '' }, (root) =>
    guardGuardrails({ ...payload, cwd: root }, { agent: 'claude', root }),
  );
  expect(during).toEqual({ exitCode: 0 });
  const after = await inRepo({ [guardrailList]: list }, (root) => ({
    claude: guardGuardrails({ ...payload, cwd: root }, { agent: 'claude', root }),
    codex: guardGuardrails({ ...payload, cwd: root }, { agent: 'codex', root }),
    other: guardGuardrails(
      { tool_name: 'Edit', tool_input: { file_path: 'tools/check-x.ts' }, cwd: root },
      { agent: 'claude', root },
    ),
  }));
  expect(decision(after.claude.stdout).permissionDecision).toBe('ask');
  expect(decision(after.codex.stdout).permissionDecision).toBe('deny');
  expect(decision(after.codex.stdout).permissionDecisionReason).toContain('wait for their answer');
  expect(after.other).toEqual({ exitCode: 0 });
});

test('after an edit, a lint problem goes back to the agent with exit 2, and a clean file is silent', () => {
  const failing = fakeRunner([{ exitCode: 1, output: 'tools/a.ts:1:1: error no-var' }]);
  const outcome = afterEdit(
    { tool_name: 'Write', tool_input: { file_path: path.join(repo, 'package.json') } },
    repo,
    failing.runner,
  );
  expect(outcome).toEqual({ exitCode: 0 });
  expect(failing.commands).toEqual([]);
  const linted = afterEdit(
    { tool_name: 'Write', tool_input: { file_path: path.join(repo, 'oxlint.config.ts') } },
    repo,
    failing.runner,
  );
  expect(failing.commands).toEqual(['oxlint oxlint.config.ts']);
  expect(linted.exitCode).toBe(2);
  expect(linted.stderr).toContain('tools/a.ts:1:1: error no-var');
  const clean = fakeRunner([]);
  expect(
    afterEdit(
      { tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'oxlint.config.ts') } },
      repo,
      clean.runner,
    ),
  ).toEqual({ exitCode: 0 });
});

test('the end of a turn runs the checks once, and never loops', () => {
  const continued = fakeRunner([]);
  expect(endOfTurn({ stop_hook_active: true }, repo, continued.runner)).toEqual({ exitCode: 0 });
  expect(continued.commands).toEqual([]);
  const clean = fakeRunner([{ exitCode: 0, output: '' }]);
  expect(endOfTurn({}, repo, clean.runner)).toEqual({ exitCode: 0 });
  expect(clean.commands).toEqual(['git status --porcelain']);
  const failing = fakeRunner([
    { exitCode: 0, output: ' M tools/a.ts\n' },
    { exitCode: 0, output: 'abc123\n' },
    { exitCode: 0, output: '' },
    { exitCode: 1, output: 'check-terms failed' },
  ]);
  const outcome = endOfTurn({}, repo, failing.runner);
  expect(failing.commands).toEqual([
    'git status --porcelain',
    'git merge-base HEAD origin/HEAD',
    'nx affected -t typecheck lint --base=abc123 --outputStyle=static',
    'nx run-many -t checks --outputStyle=static',
  ]);
  expect(outcome.exitCode).toBe(2);
  expect(outcome.stderr).toContain('check-terms failed');
});

/** Runs a real entry script in `cwd` with the payload on stdin. */
function hook(name: string, agent: string, payload: object, cwd = repo) {
  const result = Bun.spawnSync(['bun', path.join(repo, '.agents/hooks', `${name}.ts`), agent], {
    cwd,
    stdin: new TextEncoder().encode(JSON.stringify(payload)),
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString() };
}

test('the entry scripts read stdin and answer each tool in its own format', async () => {
  for (const agent of ['claude', 'codex']) {
    expect(hook('end-of-turn', agent, { hook_event_name: 'Stop', stop_hook_active: true })).toEqual(
      { exitCode: 0, stdout: '' },
    );
  }
  const answers = await inRepo({ [guardrailList]: list }, (root) =>
    ['claude', 'codex'].map((agent) =>
      hook(
        'guard-guardrails',
        agent,
        { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'oxlint.config.ts') } },
        root,
      ),
    ),
  );
  expect(
    answers.map((answer) => JSON.parse(answer.stdout).hookSpecificOutput.permissionDecision),
  ).toEqual(['ask', 'deny']);
  expect(answers.map((answer) => answer.exitCode)).toEqual([0, 0]);
});
