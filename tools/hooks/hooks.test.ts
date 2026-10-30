import { expect, test } from 'bun:test';

import { isDocsOnly, stagedCommands } from '@tools/hooks/paths.mjs';
import { parsePushedRefs, pushTargets } from '@tools/hooks/pre-push';

test('docs-only covers Markdown, the docs folder and license texts, and nothing else', () => {
  expect(
    [
      'docs/a.json',
      'AGENTS.md',
      '.agents/skills/kickoff/SKILL.md',
      'LICENSE',
      'packages/x/NOTICE.txt',
    ].every(isDocsOnly),
  ).toBe(true);
  expect(['tools/check.ts', 'package.json', '.github/workflows/ci.yml'].some(isDocsOnly)).toBe(
    false,
  );
});

test('pre-commit scans for secrets, lints, formats, then typechecks the staged tree when code changed', () => {
  expect(
    stagedCommands(['/repo/tools/a b.ts', '/repo/apps/web/app.css', '/repo/README.md'], '/repo'),
  ).toEqual([
    'gitleaks git --staged --redact --no-banner',
    'oxlint --fix "/repo/tools/a b.ts"',
    'stylelint --fix "/repo/apps/web/app.css"',
    'oxfmt --no-error-on-unmatched-pattern "/repo/tools/a b.ts" "/repo/apps/web/app.css" "/repo/README.md"',
    'bun install --frozen-lockfile',
    'nx run-many -t typecheck',
  ]);
  expect(stagedCommands(['/repo/docs/x.md'], '/repo')).toEqual([
    'gitleaks git --staged --redact --no-banner',
    'oxfmt --no-error-on-unmatched-pattern "/repo/docs/x.md"',
  ]);
});

test('pre-push reads one ref per line and ignores blank lines', () => {
  expect(
    parsePushedRefs('refs/heads/a 1111 refs/heads/a 0000\n\nrefs/heads/b 0000 refs/heads/b 2222\n'),
  ).toEqual([
    { localSha: '1111', remoteSha: '0000' },
    { localSha: '0000', remoteSha: '2222' },
  ]);
});

test('pre-push runs the fast checks on each push that changes a path, and the tests and journeys only when code changed', () => {
  const code = ['test', 'lint-policy-test', 'checks', 'journeys'];
  expect(pushTargets(['docs/a.md', 'README.md'])).toEqual(['checks']);
  expect(pushTargets(['docs/a.md', 'tools/a.ts'])).toEqual(code);
  expect(pushTargets(null)).toEqual(code);
  expect(pushTargets([])).toEqual([]);
});
