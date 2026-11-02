import { expect, test } from 'bun:test';

import { codeownersText, currentOwners, oneWayDoorGlobs, ownerPatterns } from '@tools/codeowners';
import { inRepo } from '@tools/testing/in-repo';

test('a risk glob becomes CODEOWNERS patterns', () => {
  expect(ownerPatterns('tools/lint/**')).toEqual(['/tools/lint/']);
  expect(ownerPatterns('tools/check-*.ts')).toEqual(['/tools/check-*.ts']);
  expect(ownerPatterns('**/AGENTS.md')).toEqual(['**/AGENTS.md']);
  expect(ownerPatterns('**/auth/**')).toEqual(['**/auth/']);
  expect(ownerPatterns('{apps,packages}/**/migrations/**')).toEqual([
    '/apps/**/migrations/',
    '/packages/**/migrations/',
  ]);
});

test('the one-way-door tier holds its guardrail list and its paths, and nothing else', async () => {
  const globs = await inRepo(
    {
      'tools/guardrail-files.json': JSON.stringify({ patterns: ['nx.json'] }),
      '.clutch/risk.yaml': [
        'rules:',
        '  - tier: one-way-door',
        '    guardrails: tools/guardrail-files.json',
        '    paths: [AGENTS.md]',
        '  - tier: one-way-door',
        '    paths: []',
        '  - tier: medium',
        '    paths: [apps/**]',
      ].join('\n'),
    },
    (root) => Promise.resolve(oneWayDoorGlobs(root)),
  );
  expect(globs).toEqual(['nx.json', 'AGENTS.md']);
});

test("the first one-way-door rule's except leaves those files without an owner", async () => {
  const globs = await inRepo(
    {
      'tools/guardrail-files.json': JSON.stringify({ patterns: ['tools/lint/**'] }),
      '.clutch/risk.yaml': [
        'rules:',
        '  - tier: one-way-door',
        '    guardrails: tools/guardrail-files.json',
        '    paths: []',
        "    except: ['**/*.test.ts']",
        '  - tier: one-way-door',
        '    paths: [packages/access/**]',
      ].join('\n'),
    },
    (root) => Promise.resolve(oneWayDoorGlobs(root)),
  );
  expect(globs).toEqual(['tools/lint/**', { unowned: '**/*.test.ts' }, 'packages/access/**']);
  const lines = codeownersText(globs, ['@a'])
    .split('\n')
    .filter((line) => line && !line.startsWith('#'));
  // A later rule's line comes after, so packages/access tests keep their owner.
  expect(lines).toEqual(['/tools/lint/ @a', '**/*.test.ts', '/packages/access/ @a']);
  expect(currentOwners(`**/*.test.ts\n/a @a\n`)).toEqual(['@a']);
});

test('an except on a later one-way-door rule fails, because CODEOWNERS cannot express it', async () => {
  await expect(
    inRepo(
      {
        'tools/guardrail-files.json': JSON.stringify({ patterns: [] }),
        '.clutch/risk.yaml':
          'rules:\n  - tier: one-way-door\n    paths: [b/**]\n  - tier: one-way-door\n    paths: [a/**]\n    except: [a/b]\n',
      },
      (root) => Promise.resolve().then(() => oneWayDoorGlobs(root)),
    ),
  ).rejects.toThrow('CODEOWNERS cannot express');
});

test('a repeated line keeps its last place, because the last matching line wins', () => {
  const lines = codeownersText(['a/**', { unowned: 'a/b' }, 'a/**'], ['@o'])
    .split('\n')
    .filter((line) => line && !line.startsWith('#'));
  expect(lines).toEqual(['/a/b', '/a/ @o']);
});

test('the file keeps its owners and lists each pattern once', () => {
  const text = codeownersText(['nx.json', 'nx.json', 'tools/lint/**'], ['@a', '@org/team']);
  expect(currentOwners(text)).toEqual(['@a', '@org/team']);
  expect(text.split('\n').filter((line) => line && !line.startsWith('#'))).toEqual([
    '/nx.json @a @org/team',
    '/tools/lint/ @a @org/team',
  ]);
});
