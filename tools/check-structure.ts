import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { ignoredByGit } from '@tools/check-file-size';
import { sections } from '@tools/lint/import-policy.mjs';
import { parse } from 'yaml';

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

const renderMode = /\+(api|ssg|ssr|spa)$/u;
const routeFile = /^(?!.*\.d\.ts$)(?!.*\.test\.[jt]sx?$).+\.[jt]sx?$/u;

/** Whether `text` names a package as a dependency. */
const dependsOn = (text: string, name: string) => {
  const manifest = JSON.parse(text) as { dependencies?: Record<string, string> };
  return Object.hasOwn(manifest.dependencies ?? {}, name);
};

/**
 * The render mode that One gives each page route. A suffix on the file, such
 * as `_layout+ssg.tsx`, wins. A suffix on a folder, such as `blog+ssr/`, sets
 * the mode of the routes in it. Other routes take `web.defaultRenderMode` from
 * the Vite config, which is `ssg` when the config does not set it.
 */
function routeModes(root: string, app: string): Map<string, string> {
  const modes = new Map<string, string>();
  let config = '';
  try {
    config = readFileSync(path.join(root, app, 'vite.config.ts'), 'utf-8');
  } catch {
    // One's own default applies.
  }
  const fallback = /defaultRenderMode:\s*['"](\w+)['"]/u.exec(config)?.[1] ?? 'ssg';
  const walk = (folder: string, inherited: string) => {
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
        walk(file, renderMode.exec(entry.name)?.[1] ?? inherited);
      } else if (routeFile.test(entry.name)) {
        const stem = entry.name.replace(/(?:\.(?:web|native|ios|android))?\.[jt]sx?$/u, '');
        modes.set(file, renderMode.exec(stem)?.[1] ?? inherited);
      }
    }
  };
  walk(`${app}/app`, fallback);
  return modes;
}

/** Each route of a One app under `apps/` that renders on the server, as a repository path. */
export function serverRoutes(root: string): Array<string> {
  return projects(root, 'apps')
    .filter((app) => dependsOn(readFileSync(path.join(root, app, 'package.json'), 'utf-8'), 'one'))
    .flatMap((app) => [...routeModes(root, app)])
    .filter(([, mode]) => mode === 'ssr' || mode === 'ssg')
    .map(([file]) => file);
}

type ServerRoute = { route?: unknown; reason?: unknown };

/** The entries of the list. A project with no server render needs no list file. */
function listedRoutes(root: string): Array<ServerRoute> | null {
  let text = '';
  try {
    text = readFileSync(path.join(root, serverRoutesList), 'utf-8');
  } catch {
    return [];
  }
  const list: unknown = parse(text) ?? [];
  return Array.isArray(list) ? (list as Array<ServerRoute>) : null;
}

function serverRenderProblems(root: string): Array<string> {
  const found = new Set(serverRoutes(root));
  const listed = listedRoutes(root);
  if (!listed) {
    return [`${serverRoutesList}: not a list. Write one \`- route:\` entry for each route.`];
  }
  const names = new Set(listed.map((entry) => entry.route));
  const reasons = serverRenderReasons.map((reason) => `\`${reason}\``).join(' or ');
  const problems = [...found]
    .filter((route) => !names.has(route))
    .map(
      (route) =>
        `${route}: renders on the server, but ${serverRoutesList} does not name it. Make it render in the browser, or add it to the list with the reason ${reasons}. See docs/principles/single-page-app.md.`,
    );
  for (const entry of listed) {
    const route = String(entry.route);
    if (!found.has(route)) {
      problems.push(
        `${serverRoutesList}: ${route} is not a route that renders on the server. Delete its entry.`,
      );
    } else if (!(serverRenderReasons as ReadonlyArray<unknown>).includes(entry.reason)) {
      problems.push(
        `${serverRoutesList}: ${route} has the reason \`${String(entry.reason)}\`. Give it ${reasons}. See docs/principles/single-page-app.md.`,
      );
    }
  }
  return problems;
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
