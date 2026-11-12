import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The determinism rule. Client code never reads the clock or makes a random ID:
 * only the object pool in `packages/sync` does. A command declares a `now` or
 * `new-id` stamp, and the pool fills it. See
 * docs/contributing/architecture/local-first-sync.md.
 *
 * The helpers below copy `locate`, `isTestFile` and `isServerPath` from
 * `import-policy.mjs`. A plugin loads through Node, which does not resolve
 * the `@tools/` alias, so it cannot import that file. Keep the copies in step.
 */

const sections = new Set([
  'types',
  'config',
  'contract',
  'commands',
  'repo',
  'service',
  'jobs',
  'runtime',
  'ui',
  'testing',
]);

const isTestFile = (filename) =>
  /(?:^|\/)test\//u.test(filename) || /\.(?:test|spec|pw|journey)\.[cm]?[jt]sx?$/u.test(filename);
const isServerPath = (value) => /\.server(?:\.[cm]?[jt]sx?)?$/u.test(value);

/** The repository root, tier, app or package name, and section of a file. See `locate` in `import-policy.mjs`. */
function locate(filename) {
  const match = filename.match(/^(.*?)\/(apps|features|packages|tools)\/(?:([^/]+)\/(.*))?/u);
  if (!match) {
    return null;
  }
  const [, root, tier, name, rest = ''] = match;
  const first = rest.split('/')[0];
  return {
    root,
    tier,
    name: tier === 'tools' ? undefined : name,
    section: tier === 'packages' && sections.has(first) ? first : null,
  };
}

/**
 * The client-app rule over a parsed package.json: an app that ships to a device.
 * It is the rule of `isClientApp` in `tools/apps.ts`, and
 * `tools/lint/determinism-policy.test.ts` runs both over one table of manifests.
 * A server app or a command-line app is not one, so it may read the clock.
 */
export function isClientManifest(manifest) {
  const tags = manifest.nx?.tags ?? [];
  const dependencies = Object.keys(manifest.dependencies ?? {});
  return (
    !tags.includes('platform:server') &&
    (tags.includes('platform:native') ||
      dependencies.some((dependency) => ['react', 'react-native', 'expo'].includes(dependency)))
  );
}

const clientApps = new Map();
/** Whether the app `name` under `root` is a client app, read once a run. */
function isClientApp(root, name) {
  const file = path.join(root, 'apps', name, 'package.json');
  if (!clientApps.has(file)) {
    const manifest = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : {};
    clientApps.set(file, isClientManifest(manifest));
  }
  return clientApps.get(file);
}

/** The ratchet in `.clutch/ratchets.json` that holds old call sites. */
export const ratchetName = 'no-ambient-time';

const ratchets = new Map();
/**
 * The files of a repository that the ratchet holds, read once a run. Their
 * old call sites stay counted by `clutch ratchet check`, which runs this rule
 * with `REPO_LINT_ALL=1`. See
 * docs/contributing/setup/lint-rules.md#ratchet-a-rule.
 */
function ratchetedFiles(root) {
  if (process.env.REPO_LINT_ALL === '1') {
    return new Set();
  }
  if (!ratchets.has(root)) {
    const file = path.join(root, '.clutch/ratchets.json');
    const counts = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf-8')).ratchets?.[ratchetName]?.counts ?? {})
      : {};
    ratchets.set(root, new Set(Object.keys(counts)));
  }
  return ratchets.get(root);
}

/** The global objects that hold `Date`, `crypto` and the rest: `globalThis.crypto`, `window.crypto`. */
const globals = new Set(['globalThis', 'window', 'self']);

const filenameOf = (context) => (context.filename ?? context.getFilename()).replaceAll('\\', '/');

/** The name a member expression reads: `now` for `Date.now` and `Date['now']`, or null. */
function propertyOf(member) {
  if (!member.computed) {
    return member.property.name;
  }
  return member.property.type === 'Literal' && typeof member.property.value === 'string'
    ? member.property.value
    : null;
}

/** Whether `node` names the global `name`, directly or through `globalThis`, `window` or `self`. */
function isGlobal(node, name) {
  if (node.type === 'Identifier') {
    return node.name === name;
  }
  return (
    node.type === 'MemberExpression' &&
    node.object.type === 'Identifier' &&
    globals.has(node.object.name) &&
    propertyOf(node) === name
  );
}

/** Whether a call or `new` reads the clock or makes a random value. */
function isAmbient(node) {
  if (node.type === 'NewExpression') {
    return isGlobal(node.callee, 'Date') && node.arguments.length === 0;
  }
  const { callee } = node;
  if (callee.type !== 'MemberExpression') {
    return false;
  }
  const method = propertyOf(callee);
  return (
    (isGlobal(callee.object, 'Date') && method === 'now') ||
    (isGlobal(callee.object, 'Math') && method === 'random') ||
    (isGlobal(callee.object, 'performance') && method === 'now') ||
    (isGlobal(callee.object, 'crypto') && ['randomUUID', 'getRandomValues'].includes(method))
  );
}

/**
 * Whether a file is client code. Client code is an app that ships to a
 * device, a feature, and the `ui/`, `contract/` and `commands/` of a package.
 * The object pool in `packages/sync` is exempt, and so are server files and
 * tests.
 */
export function isClientCode(filename) {
  const file = locate(filename);
  if (
    !file ||
    isTestFile(filename) ||
    isServerPath(filename) ||
    file.section === 'testing' ||
    (file.tier === 'packages' && file.name === 'sync')
  ) {
    return false;
  }
  if (file.tier === 'apps') {
    return isClientApp(file.root, file.name);
  }
  if (file.tier === 'features') {
    return true;
  }
  return file.tier === 'packages' && ['ui', 'contract', 'commands'].includes(file.section);
}

export default {
  meta: { name: 'repo-determinism' },
  rules: {
    'no-ambient-time': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          clock:
            'Only the object pool reads the clock and makes IDs on the client. Declare a `now` or `new-id` stamp in the input of the command, and the pool fills it. See docs/contributing/architecture/local-first-sync.md.',
        },
      },
      create(context) {
        const filename = filenameOf(context);
        const root = locate(filename)?.root;
        if (
          !isClientCode(filename) ||
          (root !== undefined && ratchetedFiles(root).has(filename.slice(root.length + 1)))
        ) {
          return {};
        }
        const check = (node) => {
          if (isAmbient(node)) {
            context.report({ node, messageId: 'clock' });
          }
        };
        return { CallExpression: check, NewExpression: check };
      },
    },
  },
};
