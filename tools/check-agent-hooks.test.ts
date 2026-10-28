import { expect, test } from 'bun:test';

import { checkAgentHooks, configs, ownerPattern } from '@tools/check-agent-hooks';
import { inRepo } from '@tools/testing/in-repo';

const command = (name: string, agent: string) =>
  `cd "$ROOT" && mise exec -- bun .agents/hooks/${name}.ts ${agent}`;

/** A hooks config that runs each `[event, script]` pair for `agent`. */
function config(agent: string, pairs: Array<[string, string]>) {
  const hooks: Record<string, Array<object>> = {};
  for (const [event, name] of pairs) {
    hooks[event] = [{ hooks: [{ type: 'command', command: command(name, agent) }] }];
  }
  return JSON.stringify({ hooks });
}

const pairs: Array<[string, string]> = [
  ['PreToolUse', 'guard-guardrails'],
  ['Stop', 'end-of-turn'],
];
const valid = {
  [configs.claude]: config('claude', pairs),
  [configs.codex]: config('codex', pairs),
  '.agents/hooks/guard-guardrails.ts': '',
  '.agents/hooks/end-of-turn.ts': '',
  'tools/guardrail-files.json': JSON.stringify({ patterns: ['nx.json', 'tools/lint/**'] }),
  '.github/CODEOWNERS': '# Owners\n/nx.json @owner\n/tools/lint/ @owner\n',
};

test('two configs that run the same scripts, and full CODEOWNERS, pass', async () => {
  expect(await inRepo(valid, checkAgentHooks)).toEqual([]);
  expect(ownerPattern('tools/lint/**')).toBe('/tools/lint/');
  expect(ownerPattern('tools/check-*.ts')).toBe('/tools/check-*.ts');
});

test('a hook in one config only, a wrong agent, and a missing or unused script fail', async () => {
  expect(
    await inRepo(
      {
        ...valid,
        [configs.codex]: config('codex', [['PreToolUse', 'guard-guardrails']]),
        [configs.claude]: JSON.stringify({
          hooks: {
            PreToolUse: [{ hooks: [{ command: command('guard-guardrails', 'claude') }] }],
            Stop: [{ hooks: [{ command: command('end-of-turn', 'codex') }] }],
            PostToolUse: [{ hooks: [{ command: 'echo done' }] }],
          },
        }),
        '.agents/hooks/after-edit.ts': '',
      },
      checkAgentHooks,
    ),
  ).toEqual([
    '.claude/settings.json: the Stop hook passes `codex` as the agent. Pass `claude`.',
    '.claude/settings.json: the PostToolUse hook `echo done` does not run a script in .agents/hooks/. Call `mise exec -- bun .agents/hooks/<name>.ts claude`.',
    '.agents/hooks/after-edit.ts: no hook calls it. Register it in both configs, or delete it.',
    '.agents/hooks/end-of-turn.ts: no hook calls it. Register it in both configs, or delete it.',
  ]);
  expect(
    await inRepo(
      {
        ...valid,
        [configs.codex]: config('codex', [...pairs, ['PostToolUse', 'after-edit']]),
      },
      checkAgentHooks,
    ),
  ).toEqual([
    '.claude/settings.json: register the PostToolUse after-edit hook that .codex/hooks.json has.',
    '.agents/hooks/after-edit.ts: a hook calls it, but it does not exist.',
  ]);
});

test('CODEOWNERS must name an owner for each guardrail pattern', async () => {
  expect(await inRepo({ ...valid, '.github/CODEOWNERS': '/nx.json\n' }, checkAgentHooks)).toEqual([
    '.github/CODEOWNERS: `/nx.json` has no owner. Add a handle or a team.',
    '.github/CODEOWNERS: add `/tools/lint/` with an owner. tools/guardrail-files.json lists `tools/lint/**`.',
  ]);
  const { '.github/CODEOWNERS': _, ...withoutOwners } = valid;
  expect(await inRepo(withoutOwners, checkAgentHooks)).toEqual([
    '.github/CODEOWNERS: the file is missing. Restore it from the project template.',
  ]);
});
