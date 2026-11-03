import { expect, test } from 'bun:test';
import path from 'node:path';

import { clutchOnlyNotice, findProblems } from '@tools/check-managed-links';
import type { FilesList } from '@tools/check-managed-links';
import { inRepo } from '@tools/testing/in-repo';

const list: FilesList = {
  files: [
    { path: 'packages/journeys/', rule: 'managed' },
    { path: 'docs/principles/', rule: 'managed' },
    { path: 'docs/', rule: 'seed' },
    { path: 'docs/contributing/capabilities/', rule: 'seed' },
    { path: '.github/workflows/', rule: 'managed' },
    { path: 'SECURITY.md', rule: 'seed' },
    { path: 'tools/', rule: 'managed' },
  ],
  exclude: ['docs/contributing/capabilities/registry.yaml', '.agents/skills/verify/'],
};

const run = (files: Record<string, string>) =>
  findProblems(list, Object.keys(files), (file) => files[file]);

test('a managed link to a capability page by path fails, and names its GitHub URL', () => {
  expect(
    run({
      'packages/journeys/README.md':
        'See [checks](../../docs/contributing/capabilities/a11y-checks.md).\n',
    }),
  ).toEqual([
    "packages/journeys/README.md:1: links `docs/contributing/capabilities/a11y-checks.md` by path. Link it by its GitHub URL, https://github.com/eggdev/clutch/blob/main/docs/contributing/capabilities/a11y-checks.md, because a project's copy of a capability page can be older than this link.",
  ]);
});

test('a managed link to an excluded path, or to a path no entry covers, fails', () => {
  const problems = run({
    'packages/journeys/README.md':
      '[verify](../../.agents/skills/verify/SKILL.md) and [x](../../apps/x.md)\n',
  });
  expect(problems).toHaveLength(2);
  expect(problems[0]).toContain(
    '`.agents/skills/verify/SKILL.md`, which sync and install never write',
  );
});

test('a managed link to a seed or managed path passes, and an external or anchor link passes', () => {
  expect(
    run({
      'packages/journeys/README.md': [
        '[security](../../SECURITY.md) [docs](../../docs/principles/index.md)',
        '[tool](../../tools/x.ts) [web](https://example.com) [here](#top)',
      ].join('\n'),
    }),
  ).toEqual([]);
});

test('a workflow names a capability page by path, which fails, and by its URL, which passes', () => {
  expect(
    run({
      '.github/workflows/sast.yml':
        'echo "See docs/contributing/capabilities/codeql-sast.md."\n' +
        'echo "See https://github.com/eggdev/clutch/blob/main/docs/contributing/capabilities/codeql-sast.md."\n',
    }).map((problem) => problem.split(':').slice(0, 2).join(':')),
  ).toEqual(['.github/workflows/sast.yml:1']);
});

test('a file that sync does not manage is not checked', () => {
  expect(
    run({
      'docs/contributing/security.md': 'See [capability](./capabilities/security-agent-loop.md).\n',
      'tools/guardrail-files.json': '["docs/contributing/capabilities/registry.yaml"]\n',
    }),
  ).toEqual([]);
});

test('a link inside a fenced example is not a reference', () => {
  expect(
    run({
      'packages/journeys/README.md':
        '```md\n[x](../../docs/contributing/capabilities/a11y-checks.md)\n```\n',
    }),
  ).toEqual([]);
});

test('a principles page is checked, so its link to the verify skill fails, which Clutch does not ship', () => {
  expect(
    run({
      'docs/principles/stable-layout.md': 'See [verify](../../.agents/skills/verify/SKILL.md).\n',
    }),
  ).toEqual([
    'docs/principles/stable-layout.md:1: links `.agents/skills/verify/SKILL.md`, which sync and install never write, so a project does not get it. Link it by its GitHub URL, or make it a managed or seed path in clutch.files.yaml.',
  ]);
});

test('in a project, without clutch.files.yaml, the check exits 0 with one notice line', async () => {
  await inRepo({ 'package.json': '{}' }, async (folder) => {
    const child = Bun.spawn(
      [process.execPath, path.join(import.meta.dir, 'check-managed-links.ts')],
      {
        cwd: folder,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toBe(`${clutchOnlyNotice}\n`);
  });
});
