import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { clientApps, manifestOf } from '@tools/apps';

/**
 * The first screen of a web page: the scripts that the built page names, and
 * the chunks that those import statically. The check counts the source modules
 * in them, which is the code that loads before the first paint. A count does
 * not change between runs, and it names what was added: a byte size does
 * neither. The budget is the count of today for the largest page, so each
 * module that joins a first screen is a reviewed change of this number. No
 * module of Effect may be among them, since Effect code loads after the first
 * paint. See docs/contributing/architecture/client-performance.md.
 *
 * The build has no source maps. The `chunkModules` plugin of
 * `@repo/app-build` writes the modules of each chunk beside the manifest.
 */
export const budget = 390;
/** A module of the Effect package, by its path from the repository root. */
const effectModule = /(?:^|\/)node_modules\/effect\//u;
/** The list that the `chunkModules` plugin writes, from the folder of the built client. */
const chunkModulesFile = '.vite/chunk-modules.json';

type Chunk = { readonly file: string; readonly imports?: ReadonlyArray<string> };
export type Manifest = Readonly<Record<string, Chunk>>;
type ChunkModules = Readonly<Record<string, ReadonlyArray<string>>>;

/** A module script or a module preload of a page, with the file it names. */
const pageScript =
  /<(?:script\b[^>]*\btype="module"[^>]*\bsrc|link\b[^>]*\brel="modulepreload"[^>]*\bhref)="\/?([^"]+\.js)"/gu;

/**
 * The JavaScript files that a built page loads before its first paint: each
 * module script and module preload of the page, and each chunk that one of
 * them imports statically. A chunk that loads through a dynamic import is not
 * among them.
 */
export function firstScreen(html: string, manifest: Manifest): Array<string> {
  const byFile = new Map(Object.values(manifest).map((chunk) => [chunk.file, chunk]));
  const files = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) {
      return;
    }
    files.add(file);
    for (const key of byFile.get(file)?.imports ?? []) {
      const next = manifest[key];
      if (next) {
        visit(next.file);
      }
    }
  };
  for (const [, file] of html.matchAll(pageScript)) {
    if (file) {
      visit(file);
    }
  }
  return [...files].toSorted();
}

/** Each HTML page of a built client folder, as a path from that folder. */
function pagesOf(dist: string, folder = ''): Array<string> {
  return readdirSync(path.join(dist, folder), { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      return entry.name.startsWith('.') ? [] : pagesOf(dist, name);
    }
    return entry.name.endsWith('.html') ? [name] : [];
  });
}

type Counted = { problems: Array<string>; modules: number; page: string };

/**
 * Counts the modules of the first screen of each page of a built client
 * folder, and names each problem. `modules` is the count of the largest page.
 */
export function bundleProblems(dist: string): Counted {
  const manifest: Manifest = JSON.parse(
    readFileSync(path.join(dist, '.vite/manifest.json'), 'utf-8'),
  );
  const listed = path.join(dist, chunkModulesFile);
  if (!existsSync(listed)) {
    return {
      problems: [
        `The build wrote no ${chunkModulesFile}, so its modules cannot be counted. Add the \`chunkModules\` plugin of \`@repo/app-build\` to the Vite config of the app.`,
      ],
      modules: 0,
      page: '',
    };
  }
  const chunks: ChunkModules = JSON.parse(readFileSync(listed, 'utf-8'));
  const problems: Array<string> = [];
  let largest = { modules: 0, page: '' };
  for (const page of pagesOf(dist).toSorted()) {
    const modules = new Set<string>();
    for (const file of firstScreen(readFileSync(path.join(dist, page), 'utf-8'), manifest)) {
      const found = chunks[file];
      if (found === undefined) {
        problems.push(`${page}: loads ${file}, and ${chunkModulesFile} does not list that chunk.`);
        continue;
      }
      for (const module of found) {
        modules.add(module);
      }
    }
    const effect = [...modules].filter((module) => effectModule.test(module));
    if (effect.length) {
      problems.push(
        `${page}: the first screen holds ${effect.length} modules of Effect, such as ${path.basename(effect[0] ?? '')}. Import Effect and schemas as types only (\`import type\`) in client code, and load Effect code after the first paint.`,
      );
    }
    if (modules.size === 0) {
      // A page with no script gives nothing to count, which is a broken build and not a pass.
      problems.push(
        `${page}: has no first screen to count. The page names no module script with a module. Check the web build of the app.`,
      );
    }
    if (modules.size > largest.modules) {
      largest = { modules: modules.size, page };
    }
  }
  if (largest.page === '' && problems.length === 0) {
    problems.push('The build has no page, so there is no first screen to count.');
  }
  if (largest.modules > budget) {
    problems.push(
      `${largest.page}: the first screen loads ${largest.modules} modules before the first paint, over the budget of ${budget}. Move code that the first screen does not need behind a dynamic import. To take the modules on purpose, raise \`budget\` in tools/check-bundle.ts in a reviewed change.`,
    );
  }
  return { problems, ...largest };
}

/**
 * Builds the web client of each client app with its `build:web` script, then
 * counts the modules of the first screen of each page. A One app writes the
 * client to `dist/client`, and a plain Vite app writes it to `dist`. A
 * repository with no client app has no first screen.
 */
export function checkBundle(root: string): Array<Counted & { app: string }> {
  return clientApps(root).map((name) => {
    const scripts = manifestOf(root, name).scripts ?? {};
    const app = `apps/${name}`;
    const failed = (problem: string) => ({ app, problems: [problem], modules: 0, page: '' });
    if (!scripts['build:web']) {
      return failed(
        `${app}: has no \`build:web\` script, so its first screen cannot be checked. Add the script that builds the web client.`,
      );
    }
    const build = Bun.spawnSync(['bun', 'run', 'build:web'], { cwd: path.join(root, app) });
    if (build.exitCode !== 0) {
      return failed(`${app}: \`build:web\` failed:\n${build.stderr.toString()}`);
    }
    const dist = ['dist/client', 'dist']
      .map((folder) => path.join(root, app, folder))
      .find((folder) => existsSync(path.join(folder, '.vite/manifest.json')));
    return dist
      ? { app, ...bundleProblems(dist) }
      : failed(`${app}: \`build:web\` wrote no manifest in dist/client or dist.`);
  });
}

if (import.meta.main) {
  const results = checkBundle(process.cwd());
  const problems = results.flatMap((result) => result.problems);
  if (problems.length) {
    console.error(
      [
        `First-screen check failed (${problems.length}).`,
        'See docs/contributing/architecture/client-performance.md.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else if (results.length === 0) {
    console.log('No client app in this repository, so there is no first screen to check.');
  } else {
    for (const { app, modules, page } of results) {
      console.log(
        `The largest first screen of ${app} is ${page}: ${modules} modules load before the first paint, of ${budget} allowed, and none is Effect code.`,
      );
    }
  }
}
