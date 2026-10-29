import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The Effect and React effect rules. Each rule names its fix and the page
 * that owns it. See docs/contributing/setup/lint-rules.md#effect-code.
 */

/** The calls that run an Effect. Only an edge runs one. */
const runners = new Set([
  'runPromise',
  'runSync',
  'runFork',
  'runPromiseExit',
  'runSyncExit',
  'runCallback',
]);
/** The React effect hooks. Only the sync hooks may use them. */
const effectHooks = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect']);

const filenameOf = (context) => (context.filename ?? context.getFilename()).replaceAll('\\', '/');
const isTestFile = (filename) =>
  /(?:^|\/)test\//u.test(filename) || /\.(?:test|spec|pw)\.[cm]?[jt]sx?$/u.test(filename);

/** An edge: the code that runs an Effect. `runtime/` of a package, an app, tooling or a test. */
export function isEdge(filename) {
  return (
    isTestFile(filename) ||
    /\/packages\/[^/]+\/runtime\//u.test(filename) ||
    /\/(?:apps|tools)\//u.test(filename)
  );
}

/** The files that may use the React effect hooks: the sync hooks. */
export const isEffectHookHome = (filename) => /\/packages\/sync\/ui\//u.test(filename);

const kinds = new Map();
/** The `type:` tag of the package that holds `filename`, or null. */
function packageKind(filename) {
  const match = filename.match(/^(.*\/packages\/[^/]+)\//u);
  if (!match) {
    return null;
  }
  const file = path.join(match[1], 'package.json');
  if (!kinds.has(file)) {
    const tags = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')).nx?.tags ?? []) : [];
    kinds.set(file, tags.find((tag) => tag.startsWith('type:')) ?? null);
  }
  return kinds.get(file);
}

/**
 * Server code of a product package: `service/`, `jobs/` and `.server` files. It
 * returns Effects with tagged errors. Template tooling (`type:tool`) is exempt.
 */
export function isEffectServerCode(filename) {
  return (
    !isTestFile(filename) &&
    (/\/packages\/[^/]+\/(?:service|jobs)\//u.test(filename) ||
      /\/packages\/[^/]+\/.+\.server\.[cm]?[jt]sx?$/u.test(filename)) &&
    packageKind(filename) !== 'type:tool'
  );
}

export default {
  meta: { name: 'repo-effect' },
  rules: {
    'run-at-edges': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          run: '`Effect.{{name}}` runs an Effect. Only an edge does that: `runtime/`, an app or a test. Return the Effect, and let the caller compose it. See docs/contributing/import-boundaries.md#server-code.',
        },
      },
      create(context) {
        if (isEdge(filenameOf(context))) {
          return {};
        }
        return {
          MemberExpression(node) {
            if (
              node.object.type === 'Identifier' &&
              node.object.name === 'Effect' &&
              !node.computed &&
              runners.has(node.property.name)
            ) {
              context.report({ node, messageId: 'run', data: { name: node.property.name } });
            }
          },
        };
      },
    },
    'tagged-errors': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          throw:
            'Server code fails with a tagged error, not `throw`. Return `yield* new MyError(...)` from `Effect.gen`. See docs/principles/fail-loudly.md.',
          async:
            'Server code returns an Effect, not a Promise. Use `Effect.gen`, and wrap a Promise API with `Effect.tryPromise`. See docs/principles/fail-loudly.md.',
        },
      },
      create(context) {
        if (!isEffectServerCode(filenameOf(context))) {
          return {};
        }
        const asyncFunction = (node) => {
          if (node.async) {
            context.report({ node, messageId: 'async' });
          }
        };
        return {
          ThrowStatement: (node) => context.report({ node, messageId: 'throw' }),
          FunctionDeclaration: asyncFunction,
          FunctionExpression: asyncFunction,
          ArrowFunctionExpression: asyncFunction,
          NewExpression(node) {
            if (node.callee.type === 'Identifier' && node.callee.name === 'Promise') {
              context.report({ node, messageId: 'async' });
            }
          },
        };
      },
    },
    'no-react-effects': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          hook: '`{{name}}` is an effect. Derive the value in render, run the work in an event handler, or read records with the sync hooks. See docs/principles/local-first.md.',
        },
      },
      create(context) {
        if (isEffectHookHome(filenameOf(context))) {
          return {};
        }
        const reactNames = new Set();
        return {
          ImportDeclaration(node) {
            if (node.source.value !== 'react') {
              return;
            }
            for (const specifier of node.specifiers) {
              if (
                specifier.type === 'ImportDefaultSpecifier' ||
                specifier.type === 'ImportNamespaceSpecifier'
              ) {
                reactNames.add(specifier.local.name);
              }
            }
          },
          MemberExpression(node) {
            if (
              node.object.type === 'Identifier' &&
              reactNames.has(node.object.name) &&
              !node.computed &&
              effectHooks.has(node.property.name)
            ) {
              context.report({ node, messageId: 'hook', data: { name: node.property.name } });
            }
          },
        };
      },
    },
  },
};
