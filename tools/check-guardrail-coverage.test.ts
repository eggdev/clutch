import { expect, test } from 'bun:test';

import { checkGuardrailCoverage, entryScripts } from '@tools/check-guardrail-coverage';
import { inRepo } from '@tools/testing/in-repo';

/** A repository whose one check reads a config file and imports a helper that reads another. */
const repo = (list: object) => ({
  'package.json': JSON.stringify({
    nx: { targets: { 'check-x': { command: 'bun tools/check-x.ts' } } },
  }),
  'tools/check-x.ts': [
    "import { rows } from '@tools/shared';",
    "export const config = 'tools/rules.json';",
    "export const doc = 'AGENTS.md';",
    "export const missing = 'tools/gone.json';",
    'export { rows };',
  ].join('\n'),
  'tools/shared.ts': "export const rows = 'tools/rows.yaml';",
  'tools/rules.json': '{}',
  'tools/rows.yaml': '',
  'AGENTS.md': '',
  'tools/guardrail-files.json': JSON.stringify(list),
});

test('each file that a check reads, or a helper it imports reads, needs a guardrail pattern', async () => {
  expect(
    await inRepo(repo({ patterns: ['package.json', 'tools/check-*.ts'] }), (root) =>
      checkGuardrailCoverage(root).map((problem) => problem.split(' reads it')[0]),
    ),
  ).toEqual([
    'AGENTS.md: tools/check-x.ts',
    'tools/rows.yaml: tools/shared.ts',
    'tools/rules.json: tools/check-x.ts',
    'tools/shared.ts: tools/check-x.ts',
  ]);
});

test('a pattern or an exempt entry with a reason covers a file, and an empty reason fails', async () => {
  expect(
    await inRepo(
      repo({
        patterns: ['package.json', 'tools/check-*.ts', 'tools/shared.ts', 'tools/*.{json,yaml}'],
        exempt: { 'AGENTS.md': 'A check measures it. It sets no rule.' },
      }),
      checkGuardrailCoverage,
    ),
  ).toEqual([]);
  expect(
    await inRepo(
      repo({
        patterns: ['package.json', 'tools/check-*.ts', 'tools/shared.ts', 'tools/*.{json,yaml}'],
        exempt: { 'AGENTS.md': ' ' },
      }),
      checkGuardrailCoverage,
    ),
  ).toEqual([
    'tools/guardrail-files.json: `exempt.AGENTS.md` has no reason. Say why it sets no rule.',
  ]);
});

test('the entry scripts come from the targets, the lint config and the hook configs', async () => {
  expect(
    await inRepo(
      {
        'package.json': JSON.stringify({ scripts: { a: 'bun tools/a.ts' } }),
        'oxlint.config.ts': "export const plugin = './tools/lint/policy.mjs';",
        '.claude/settings.json': JSON.stringify({
          hooks: { command: 'bun .agents/hooks/guard.ts' },
        }),
        'tools/a.ts': '',
        'tools/lint/policy.mjs': '',
        '.agents/hooks/guard.ts': '',
      },
      entryScripts,
    ),
  ).toEqual(['.agents/hooks/guard.ts', 'tools/a.ts', 'tools/lint/policy.mjs']);
});
