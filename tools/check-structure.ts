import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { ignoredByGit } from '@tools/check-file-size';
import { sections } from '@tools/lint/import-policy.mjs';
import { YAMLParseError, parse } from 'yaml';

/**
 * The shape of each package and feature. A package has only section folders
 * and a few config files at its top. A feature has its gate, `screens/`,
 * `components/` and `journeys/`. The generators make these shapes; this check
 * rejects any other. An `AGENTS.md` file and its `CLAUDE.md` include can also
 * sit at the top. `check-journeys` checks the journeys, and `check-primitives`
 * checks that each one has a primitive. See
 * docs/contributing/architecture/index.md.
 *
 * The check also holds the single-page app principle. Each route of a One app
 * that renders on the server needs an entry in `serverRoutesList`, with one of
 * the two reasons of docs/principles/single-page-app.md.
 */
const projectFiles = new Set([
  'package.json',
  'tsconfig.json',
  'tsconfig.lib.json',
  'tsconfig.spec.json',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
]);
const packageFiles = new Set([...projectFiles, 'drizzle.config.ts']);
const featureFolders = new Set(['screens', 'components', 'journeys']);
const skipped = new Set(['node_modules', 'out-tsc', 'dist']);

/** Each folder under `parent` with a package.json, as a repository path. */
function projects(root: string, parent: string): Array<string> {
  try {
    return readdirSync(path.join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`)
      .filter((folder) => {
        try {
          return statSync(path.join(root, folder, 'package.json')).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

/** The top-level entries of a project that Git tracks or would track. */
function entries(root: string, folder: string) {
  const all = readdirSync(path.join(root, folder), { withFileTypes: true }).filter(
    (entry) => !skipped.has(entry.name) && entry.name !== '.gitkeep',
  );
  const ignored = ignoredByGit(
    root,
    all.map((entry) => `${folder}/${entry.name}`),
  );
  return all.filter((entry) => !ignored.has(`${folder}/${entry.name}`));
}

function packageProblems(root: string, folder: string): Array<string> {
  const names = Object.keys(sections).join(', ');
  return entries(root, folder)
    .filter((entry) =>
      entry.isDirectory() ? !Object.hasOwn(sections, entry.name) : !packageFiles.has(entry.name),
    )
    .map((entry) =>
      entry.isDirectory()
        ? `${folder}/${entry.name}/: not a section. Move the code into one of: ${names}.`
        : `${folder}/${entry.name}: a package keeps code in sections. Move the file into the section that owns it.`,
    );
}

function featureProblems(root: string, folder: string): Array<string> {
  const found = entries(root, folder);
  const problems = found
    .filter((entry) =>
      entry.isDirectory()
        ? !featureFolders.has(entry.name)
        : entry.name !== 'gate.ts' && !projectFiles.has(entry.name),
    )
    .map(
      (entry) =>
        `${folder}/${entry.name}${entry.isDirectory() ? '/' : ''}: a feature has only \`gate.ts\`, \`screens/\`, \`components/\` and \`journeys/\`. Move shared code into a package.`,
    );
  if (!found.some((entry) => entry.name === 'gate.ts' && entry.isFile())) {
    problems.push(
      `${folder}: has no \`gate.ts\`. Each feature has one gate. See docs/principles/one-gate-per-feature.md.`,
    );
  }
  return problems;
}

/** The list of routes that render on the server, each with its reason. */
export const serverRoutesList = 'tools/server-rendered-routes.yaml';

/** The two reasons of docs/principles/single-page-app.md for a server render. */
export const serverRenderReasons = ['seen without the app', 'ready sooner'] as const;

const principle = 'See docs/principles/single-page-app.md.';
const spaFix = "Set `web: { defaultRenderMode: 'spa' }` as a string literal.";

/*
 * The rules below copy One 1.27.1. Each route is a `.ts` or `.tsx` file
 * (`ROUTE_GLOB_PATTERN` in `router/glob-patterns.mjs`). The web build leaves
 * out `.native`, `.ios` and `.android` files (`ROUTE_WEB_EXCLUSION_GLOB_PATTERNS`).
 * The router skips `.d.ts` files and the top `+html` file (`getRoutes.mjs`).
 * Test files are routes, unless the config sets `router.ignoredRouteFiles`.
 * The mode suffixes come from `matchFileRenderMode` and
 * `directoryRenderModeRe` in `router/matchers.mjs`.
 */
const routeFile = /\.tsx?$/u;
const notRouteFile = [/\.d\.ts$/u, /\.(?:native|ios|android)\.tsx?$/u];
const topHtmlFile = /^\+html\.[jt]sx?$/u;
const fileRenderMode = /\+(api|ssg|ssr|spa)\.(?:\w+\.)?[jt]sx?$/u;
const folderRenderMode = /^(.+)\+(api|ssg|ssr|spa)$/u;

/** Whether `text` names a package as a dependency or a dev dependency. */
const dependsOn = (text: string, name: string) => {
  const manifest = JSON.parse(text) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return [manifest.dependencies, manifest.devDependencies].some((deps) =>
    Object.hasOwn(deps ?? {}, name),
  );
};

/** `source` with its `//` and `/* *\/` comments removed. String literals stay. */
export function withoutComments(source: string): string {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      index = end === -1 ? source.length : end;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      out += ' ';
    } else if (char === "'" || char === '"' || char === '`') {
      let end = index + 1;
      while (end < source.length && source[end] !== char) {
        end += source[end] === '\\' ? 2 : 1;
      }
      out += source.slice(index, end + 1);
      index = end + 1;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}

/**
 * The default render mode that the Vite config of an app sets, or a problem
 * when the check cannot read it. The check reads the mode only when the code
 * names `defaultRenderMode` once, with a string literal as its value.
 */
function defaultMode(root: string, app: string): { mode: string } | { problem: string } {
  const file = `${app}/vite.config.ts`;
  let config;
  try {
    config = withoutComments(readFileSync(path.join(root, file), 'utf-8'));
  } catch {
    return {
      problem: `${file}: does not exist, so One renders each route on the server by default. Create it. ${spaFix} ${principle}`,
    };
  }
  const named = config.match(/\bdefaultRenderMode\b/gu) ?? [];
  const literal = /\bdefaultRenderMode\s*:\s*(['"`])(ssg|ssr|spa)\1/u.exec(config);
  if (named.length !== 1 || !literal) {
    return {
      problem: `${file}: the check cannot read the default render mode. It reads one \`defaultRenderMode\` with a string literal value. ${spaFix} ${principle}`,
    };
  }
  return { mode: literal[2] };
}

/**
 * The render mode of each route of an app. A suffix on the file, such as
 * `_layout+ssg.tsx`, wins. A suffix on a folder, such as `blog+ssr/`, sets the
 * mode of the routes in it. Other routes take the default mode, which is
 * `undefined` here.
 */
function routeModes(root: string, app: string): Map<string, string | undefined> {
  const modes = new Map<string, string | undefined>();
  const walk = (folder: string, inherited: string | undefined, top: boolean) => {
    let found;
    try {
      found = readdirSync(path.join(root, folder), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of found) {
      const file = `${folder}/${entry.name}`;
      if (skipped.has(entry.name)) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(file, folderRenderMode.exec(entry.name)?.[2] ?? inherited, false);
      } else if (
        routeFile.test(entry.name) &&
        !notRouteFile.some((pattern) => pattern.test(entry.name)) &&
        !(top && topHtmlFile.test(entry.name))
      ) {
        modes.set(file, fileRenderMode.exec(entry.name)?.[1] ?? inherited);
      }
    }
  };
  walk(`${app}/app`, undefined, true);
  return modes;
}

const serverMode = (mode: string | undefined) => mode === 'ssr' || mode === 'ssg';

/**
 * The routes of each One app under `apps/`, as repository paths. `server`
 * renders on the server. `unknown` takes a default mode that the check cannot
 * read. `byDefault` holds, for each config with a server default, the routes
 * that take it. `problems` names each config that the check cannot read.
 */
function appRoutes(root: string) {
  const server: Array<string> = [];
  const unknown: Array<string> = [];
  const byDefault = new Map<string, { mode: string; routes: Array<string> }>();
  const problems: Array<string> = [];
  const apps = projects(root, 'apps').filter((app) =>
    dependsOn(readFileSync(path.join(root, app, 'package.json'), 'utf-8'), 'one'),
  );
  for (const app of apps) {
    const fallback = defaultMode(root, app);
    if ('problem' in fallback) {
      problems.push(fallback.problem);
    }
    const takesDefault: Array<string> = [];
    for (const [file, mode] of routeModes(root, app)) {
      if (mode === undefined) {
        takesDefault.push(file);
      } else if (serverMode(mode)) {
        server.push(file);
      }
    }
    if (!('mode' in fallback)) {
      unknown.push(...takesDefault);
    } else if (serverMode(fallback.mode) && takesDefault.length > 0) {
      server.push(...takesDefault);
      byDefault.set(`${app}/vite.config.ts`, { mode: fallback.mode, routes: takesDefault });
    }
  }
  return { server, unknown, byDefault, problems };
}

/** Each route of a One app under `apps/` that renders on the server, as a repository path. */
export function serverRoutes(root: string): Array<string> {
  return appRoutes(root).server;
}

/** The entries of the list, or a problem with the file as a whole. */
function listedRoutes(root: string): Array<unknown> | string {
  let text;
  try {
    text = readFileSync(path.join(root, serverRoutesList), 'utf-8');
  } catch {
    // A project with no server render needs no list file.
    return [];
  }
  let list: unknown;
  try {
    list = parse(text) ?? [];
  } catch (error) {
    const line = error instanceof YAMLParseError ? error.linePos?.[0].line : undefined;
    return `${serverRoutesList}: not valid YAML${line ? ` (line ${line})` : ''}. Fix the syntax. Write one \`- route:\` entry for each route.`;
  }
  return Array.isArray(list)
    ? list
    : `${serverRoutesList}: not a list. Write one \`- route:\` entry for each route.`;
}

function serverRenderProblems(root: string): Array<string> {
  const { server, unknown, byDefault, problems } = appRoutes(root);
  const found = new Set(server);
  const maybe = new Set(unknown);
  const listed = listedRoutes(root);
  if (typeof listed === 'string') {
    return [...problems, listed];
  }
  const reasons = serverRenderReasons.map((reason) => `\`${reason}\``).join(' or ');
  const counts = new Map<string, number>();
  for (const [index, entry] of listed.entries()) {
    const position = `${serverRoutesList}: entry ${index + 1}`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(
        `${position} is not an entry. Write it as \`- route: <file>\` with a \`reason:\` line.`,
      );
      continue;
    }
    const { route, reason } = entry as { route?: unknown; reason?: unknown };
    if (typeof route !== 'string') {
      problems.push(`${position} has no \`route\`. Give it the path of the route file.`);
      continue;
    }
    counts.set(route, (counts.get(route) ?? 0) + 1);
    if (!found.has(route) && !maybe.has(route)) {
      problems.push(
        `${serverRoutesList}: ${route} is not a route that renders on the server. Delete its entry.`,
      );
    } else if (!(serverRenderReasons as ReadonlyArray<unknown>).includes(reason)) {
      problems.push(
        `${serverRoutesList}: ${route} has the reason \`${String(reason)}\`. Give it ${reasons}. ${principle}`,
      );
    }
  }
  for (const [route, count] of counts) {
    if (count > 1) {
      problems.push(
        `${serverRoutesList}: ${route} has ${count} entries. Keep one entry for each route.`,
      );
    }
  }
  const unlisted = new Set([...found].filter((route) => !counts.has(route)));
  for (const route of unlisted) {
    problems.push(
      `${route}: renders on the server, but ${serverRoutesList} does not name it. Make it render in the browser, or add it to the list with the reason ${reasons}. ${principle}`,
    );
  }
  for (const [config, { mode, routes }] of byDefault) {
    if (routes.some((route) => unlisted.has(route))) {
      problems.push(
        `${config}: sets the default render mode to \`${mode}\`, so each route without a mode renders on the server. ${spaFix} ${principle}`,
      );
    }
  }
  return [...new Set(problems)];
}

export function checkStructure(root: string): Array<string> {
  return [
    ...projects(root, 'packages').flatMap((folder) => packageProblems(root, folder)),
    ...projects(root, 'features').flatMap((folder) => featureProblems(root, folder)),
    ...serverRenderProblems(root),
  ].toSorted();
}

if (import.meta.main) {
  const problems = checkStructure(process.cwd());
  if (problems.length) {
    console.error(
      [
        `Structure check failed (${problems.length}).`,
        'A generator makes each shape: `nx g @tools/generators:package` or `:feature`.',
        `Each route that renders on the server needs an entry in ${serverRoutesList}.`,
        'See docs/contributing/architecture/index.md.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log(
      'Each package has only sections, each feature has its gate, and each server render names its reason.',
    );
  }
}
