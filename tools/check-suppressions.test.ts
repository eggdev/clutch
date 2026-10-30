import { expect, test } from 'bun:test';

import { checkSuppressions } from '@tools/check-suppressions';
import { inRepo } from '@tools/testing/in-repo';

/** Joins a directive from parts, so this file does not match the check itself. */
const directive = (...parts: Array<string>) => parts.join('-');

test('each lint and type suppression fails, in source, tooling and root config files', async () => {
  const matches = await inRepo(
    {
      'apps/web/src/a.ts': [
        `// ${directive('oxlint', 'disable', 'next', 'line')} typescript/no-explicit-any`,
        `// ${directive('eslint', 'disable', 'line')} no-console`,
        `/* ${directive('oxlint', 'disable')} */`,
      ].join('\n'),
      'packages/ui/src/b.tsx': `{/* ${directive('eslint', 'disable', 'next', 'line')} */}`,
      'packages/ui/src/c.css': `/* ${directive('stylelint', 'disable')} */`,
      'tools/d.ts': [
        `// @${directive('ts', 'expect', 'error')}: a reason does not help`,
        `// @${directive('ts', 'ignore')}`,
        `// @${directive('ts', 'nocheck')}`,
        `// ${directive('biome', 'ignore')} lint: reason`,
      ].join('\n'),
      'vite.config.ts': `// ${directive('eslint', 'disable', 'next', 'line')}`,
    },
    checkSuppressions,
  );
  expect(matches.map((m) => `${m.file}:${m.line} ${m.label}`)).toEqual([
    'apps/web/src/a.ts:1 lint disable',
    'apps/web/src/a.ts:2 lint disable',
    'apps/web/src/a.ts:3 lint disable',
    'packages/ui/src/b.tsx:1 lint disable',
    'packages/ui/src/c.css:1 lint disable',
    'tools/d.ts:1 type check suppression',
    'tools/d.ts:2 type check suppression',
    'tools/d.ts:3 type check suppression',
    'tools/d.ts:4 biome ignore',
    'vite.config.ts:1 lint disable',
  ]);
});

test('prose about a directive, a string that is not a comment, and node_modules pass', async () => {
  expect(
    await inRepo(
      {
        'tools/e.ts': `const label = '${directive('eslint', 'disable')}';\n// Never add a suppression.\n`,
        'node_modules/x/index.ts': `// @${directive('ts', 'ignore')}`,
        'packages/ui/src/f.ts': 'export const value = 1;\n',
      },
      checkSuppressions,
    ),
  ).toEqual([]);
});

test('a semgrep suppression needs the rule and a reason, in source, scripts and workflows', async () => {
  const semgrep = `no${'semgrep'}`;
  const matches = await inRepo(
    {
      'tools/g.ts': [
        `// ${semgrep}`,
        `// ${semgrep}: prototype-pollution-loop`,
        `// ${semgrep}: prototype-pollution-loop -- reads only, and Object.hasOwn skips inherited keys.`,
        `const value = 1; // ${semgrep}: a.b, c-d -- the input is a constant.`,
      ].join('\n'),
      'tools/verification/h.py': `x = 1  # ${semgrep}\ny = 2  # ${semgrep}: rule -- a reason\n`,
      '.github/workflows/i.yml': `# no${'sem'}: rule\n`,
    },
    checkSuppressions,
  );
  expect(matches.map((m) => `${m.file}:${m.line} ${m.label}`)).toEqual([
    '.github/workflows/i.yml:1 semgrep suppression without a reason',
    'tools/g.ts:1 semgrep suppression without a reason',
    'tools/g.ts:2 semgrep suppression without a reason',
    'tools/verification/h.py:1 semgrep suppression without a reason',
  ]);
});
