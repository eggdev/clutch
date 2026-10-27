import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { gateProblem } from '@tools/lint/gate-policy.mjs';

const root = path.resolve(import.meta.dir, '../..');
const gates = { '/feature': { gate: 'lib/feature.ts', routes: 'app/feature' } };

/** Lints files in a scratch project that gates `/feature`, and lists `file:line` for each finding. */
async function lint(files: Record<string, string>): Promise<Array<string>> {
  const directory = await mkdtemp(path.join(tmpdir(), 'gate-rule-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), source);
    }
    await writeFile(
      path.join(directory, 'oxlint.json'),
      JSON.stringify({
        jsPlugins: [
          { name: 'repo-gates', specifier: path.resolve(root, 'tools/lint/gate-policy.mjs') },
        ],
        rules: { 'repo-gates/one-gate': ['error', { gates }] },
      }),
    );
    const run = Bun.spawnSync(
      [
        path.resolve(root, 'node_modules/.bin/oxlint'),
        '-c',
        'oxlint.json',
        '--format',
        'json',
        '.',
      ],
      { cwd: directory },
    );
    const result = JSON.parse(run.stdout.toString());
    return result.diagnostics
      .filter((item: { code: string }) => item.code === 'repo-gates(one-gate)')
      .map(
        (item: { filename: string; labels: Array<{ span: { line: number } }> }) =>
          `${item.filename}:${item.labels[0]?.span.line}`,
      )
      .toSorted();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('gateProblem allows the gate and the route folder, and refuses every other way in', () => {
  expect(gateProblem('/feature/1', 'lib/feature.ts', gates)).toBeNull();
  expect(gateProblem('/feature/1/details', 'app/feature/[id]/index.tsx', gates)).toBeNull();
  expect(gateProblem('/features', 'app/home.tsx', gates)).toBeNull();
  expect(gateProblem('/feature', 'app/home.tsx', gates)).toEqual({
    route: '/feature',
    gate: 'lib/feature.ts',
  });
  expect(gateProblem('/feature?draft=1', 'app/home.tsx', gates)).not.toBeNull();
});

test('a second way into a gated feature fails lint, and a name that does not navigate passes', async () => {
  expect(
    await lint({
      'lib/feature.ts':
        "export const open = (push: (href: string) => void) => push('/feature/new');\n",
      'app/home.tsx': `declare const router: { push: (href: string) => void };
router.push(\`/feature/\${'id'}\`);
export const link = { href: '/feature' };
export const screen = '/feature/:id';
`,
    }),
  ).toEqual(['app/home.tsx:2', 'app/home.tsx:3']);
});
