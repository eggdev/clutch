import { expect, test } from 'bun:test';

import { budget, bundleProblems, firstScreen } from '@tools/check-bundle';
import { inRepo } from '@tools/testing/in-repo';

const manifest = JSON.stringify({
  'virtual:entry': {
    file: 'assets/entry.js',
    isEntry: true,
    imports: ['_vendor.js'],
    dynamicImports: ['../../packages/sync/runtime/transport.ts'],
  },
  '_vendor.js': { file: 'assets/vendor.js' },
  'app/notes.tsx': { file: 'assets/notes.js', imports: ['_vendor.js'] },
  '../../packages/sync/runtime/transport.ts': { file: 'assets/transport.js' },
});

/** A built page that names each file as a module script, and the first also as a preload. */
const page = (...files: Array<string>) =>
  [
    `<link rel="modulepreload" fetchPriority="low" href="/${files[0] ?? ''}"/>`,
    ...files.map((file) => `<script type="module" src="/${file}" async=""></script>`),
  ].join('');

type Modules = { entry: Array<string>; vendor: Array<string>; notes: Array<string> };

/** A built client folder: a home page, a notes page that loads one more chunk, and a chunk that loads later. */
const dist = (modules: Modules, later = ['node_modules/effect/dist/Effect.js']) => ({
  '.vite/manifest.json': manifest,
  '.vite/chunk-modules.json': JSON.stringify({
    'assets/entry.js': modules.entry,
    'assets/vendor.js': modules.vendor,
    'assets/notes.js': modules.notes,
    'assets/transport.js': later,
  }),
  'index.html': page('assets/entry.js'),
  'notes.html': page('assets/entry.js', 'assets/notes.js'),
});

const few: Modules = {
  entry: ['apps/app/lib/boot.ts', 'node_modules/react/index.js'],
  // The bundler can put one module in two chunks. It counts once.
  vendor: ['node_modules/react/index.js', 'node_modules/idb/build.js'],
  notes: ['features/notes/screens/notes-screen.tsx'],
};

test('the first screen of a page is its scripts and their static imports, not a dynamic import', () => {
  expect(firstScreen(page('assets/entry.js'), JSON.parse(manifest))).toEqual([
    'assets/entry.js',
    'assets/vendor.js',
  ]);
});

test('the count is of the largest page, each module once, and not of a later chunk', async () => {
  expect(await inRepo(dist(few), bundleProblems)).toEqual({
    problems: [],
    modules: 4,
    page: 'notes.html',
  });
});

test('a module of Effect in a first screen fails, and Effect code after the first paint passes', async () => {
  const effect = ['node_modules/effect/dist/Schema.js', 'node_modules/effect/dist/Effect.js'];
  // A value import from `types/` in UI code pulls the Effect runtime into a chunk of the notes page.
  const { problems } = await inRepo(dist({ ...few, notes: effect }), bundleProblems);
  expect(problems).toEqual([
    'notes.html: the first screen holds 2 modules of Effect, such as Schema.js. Import Effect and schemas as types only (`import type`) in client code, and load Effect code after the first paint.',
  ]);
});

test('a first screen over the module budget fails with its page and its count', async () => {
  const many = Array.from({ length: budget + 1 }, (_, index) => `apps/app/lib/module-${index}.ts`);
  const over = await inRepo(dist({ entry: many, vendor: [], notes: [] }), bundleProblems);
  expect(over.problems).toEqual([
    `index.html: the first screen loads ${budget + 1} modules before the first paint, over the budget of ${budget}. Move code that the first screen does not need behind a dynamic import. To take the modules on purpose, raise \`budget\` in tools/check-bundle.ts in a reviewed change.`,
  ]);
  const within = many.slice(1);
  const under = await inRepo(dist({ entry: within, vendor: [], notes: [] }), bundleProblems);
  expect(under.problems).toEqual([]);
});

test('a build with no list of chunk modules fails, and names the plugin that writes it', async () => {
  const { '.vite/chunk-modules.json': _dropped, ...withoutList } = dist(few);
  const { problems } = await inRepo(withoutList, bundleProblems);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('Add the `chunkModules` plugin of `@repo/app-build`');
});

test('a chunk that the list leaves out fails, since its modules cannot be counted', async () => {
  const files = dist(few);
  const listed = JSON.parse(files['.vite/chunk-modules.json']);
  delete listed['assets/vendor.js'];
  const { problems } = await inRepo(
    { ...files, '.vite/chunk-modules.json': JSON.stringify(listed) },
    bundleProblems,
  );
  expect(problems).toContain(
    'index.html: loads assets/vendor.js, and .vite/chunk-modules.json does not list that chunk.',
  );
});

test('a page with no script fails, and so does a build with no page', async () => {
  const empty = await inRepo({ ...dist(few), 'about.html': '<p>About</p>' }, bundleProblems);
  expect(empty.problems).toEqual([
    'about.html: has no first screen to count. The page names no module script with a module. Check the web build of the app.',
  ]);
  const { 'index.html': _home, 'notes.html': _notes, ...noPage } = dist(few);
  const none = await inRepo(noPage, bundleProblems);
  expect(none.problems).toEqual(['The build has no page, so there is no first screen to count.']);
});
