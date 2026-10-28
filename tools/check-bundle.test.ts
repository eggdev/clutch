import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';

import { bundleProblems, firstScreen } from '@tools/check-bundle';
import { inRepo } from '@tools/testing/in-repo';

/** The problems that `bundleProblems` finds in a `dist` folder. */
async function problemsOf(dist: string): Promise<Array<string>> {
  const { problems } = await bundleProblems(dist);
  return problems;
}

const manifest = (entryImports: Array<string>) =>
  JSON.stringify({
    'index.html': {
      file: 'assets/index.js',
      isEntry: true,
      imports: entryImports,
      dynamicImports: ['../../packages/sync/runtime/transport.ts'],
    },
    '_vendor.js': { file: 'assets/vendor.js' },
    '../../packages/sync/runtime/transport.ts': { file: 'assets/transport.js' },
  });

test('the first screen is the entry and its static imports, not its dynamic imports', () => {
  expect(firstScreen(JSON.parse(manifest(['_vendor.js'])))).toEqual([
    'assets/index.js',
    'assets/vendor.js',
  ]);
});

test('Effect code in the first screen fails, and Effect code after the first paint passes', async () => {
  const files = {
    'assets/index.js': 'console.log("app");',
    'assets/transport.js': 'const fiber = "~effect/Fiber";',
  };
  expect(
    await inRepo(
      { '.vite/manifest.json': manifest(['_vendor.js']), ...files, 'assets/vendor.js': 'x' },
      problemsOf,
    ),
  ).toEqual([]);
  expect(
    await inRepo(
      {
        '.vite/manifest.json': manifest(['_vendor.js']),
        ...files,
        // A value import from `types/` in UI code pulls the Effect runtime into a first-screen chunk.
        'assets/vendor.js': 'const schema = "~effect/Schema";',
      },
      problemsOf,
    ),
  ).toEqual([
    'assets/vendor.js: the first screen holds Effect code. Import Effect and schemas as types only (`import type`) in client code, and load Effect code after the first paint.',
  ]);
});

test('a first screen over 150 kB compressed fails with both sizes', async () => {
  const { problems } = await inRepo(
    {
      '.vite/manifest.json': manifest(['_vendor.js']),
      'assets/index.js': 'x',
      'assets/vendor.js': randomBytes(200_000).toString('latin1'),
      'assets/transport.js': '',
    },
    bundleProblems,
  );
  expect(problems.map((problem) => problem.replace(/[\d.]+ kB with/u, 'N kB with'))).toEqual([
    'The first screen is N kB with gzip, over the budget of 150.0 kB. Move code that the first screen does not need behind a dynamic import.',
    'The first screen is N kB with brotli, over the budget of 150.0 kB. Move code that the first screen does not need behind a dynamic import.',
  ]);
});
