/**
 * The layout lint. A component responds to its container and never reads the
 * width of the window. Only the app shell switches layout on the window
 * width. The `shell` option lists the shell files, from the repository root.
 * See docs/principles/mobile-first.md.
 *
 * `repositoryOf` below copies the one in `component-policy.mjs`. A plugin
 * imports no other file of this repository, because `repo-imports/aliases-only`
 * bans a relative path and Node does not resolve the `@tools/` alias. Keep the
 * copies in step.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The ratchet in `.clutch/ratchets.json` that holds old call sites. */
export const ratchetName = 'no-viewport-reads';

/** The global objects that hold the window's fields: `window.innerWidth`, `globalThis.matchMedia`. */
const globals = new Set(['window', 'globalThis', 'self']);
/** Window fields that hold a width. */
const widthFields = new Set(['innerWidth', 'outerWidth']);
/** Fields of `screen` that hold a width. */
const screenFields = new Set(['width', 'availWidth']);

/**
 * Whether a media query reads the width: `width`, `min-width`, `max-width`
 * and the `device-` forms. `(prefers-reduced-motion)` and `(hover: hover)` do
 * not.
 */
export function readsWidth(query) {
  return /(?:^|[^\w-])(?:(?:min|max)-)?(?:device-)?width\b/iu.test(query);
}

/** The text of a string literal or a template literal with no expressions, or null. */
function staticText(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked).join('');
  }
  return null;
}

/** The name a member expression reads: `innerWidth` for `window.innerWidth` and `window['innerWidth']`, or null. */
function propertyOf(member) {
  if (!member.computed) {
    return member.property.name;
  }
  return staticText(member.property);
}

/** The key names of an object pattern, such as `innerWidth` in `const { innerWidth } = window`. */
function patternKeys(pattern) {
  return pattern.properties
    .filter((item) => item.type === 'Property')
    .map((item) => (item.computed ? staticText(item.key) : (item.key.name ?? item.key.value)));
}

/** Files that may read the window: tests and `testing/` helpers. */
export function isExempt(file) {
  return (
    /(?:^|\/)(?:test|testing)\//u.test(file) ||
    /\.(?:test|spec|pw|journey)\.[cm]?[jt]sx?$/u.test(file)
  );
}

const roots = new Map();
/**
 * The repository that holds a file: the nearest folder whose `package.json`
 * declares workspaces. See `repositoryOf` in `component-policy.mjs`.
 */
function repositoryOf(file) {
  const folder = path.dirname(file);
  if (!roots.has(folder)) {
    const manifest = path.join(folder, 'package.json');
    const isRoot =
      existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf-8')).workspaces !== undefined;
    const parent = path.dirname(folder);
    roots.set(folder, isRoot || parent === folder ? folder : repositoryOf(folder));
  }
  return roots.get(folder);
}

const isCallee = (node) => node.parent?.type === 'CallExpression' && node.parent.callee === node;
/**
 * Whether code gives `node` a local name: `const media = matchMedia` or
 * `view = window`. Lint follows no local name, so each read through it is
 * hidden.
 */
const isAliased = (node) =>
  (node.parent?.type === 'VariableDeclarator' &&
    node.parent.init === node &&
    node.parent.id.type === 'Identifier') ||
  (node.parent?.type === 'AssignmentExpression' && node.parent.right === node);
const isWidthField = (owner, name) =>
  owner === 'screen' ? screenFields.has(name) : widthFields.has(name);

/** Nodes that hold one expression and do not change its value: `window as Window`, `window!`, `(window)`. */
const wrappers = new Set([
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
  'ParenthesizedExpression',
]);
/** `node`, or the outermost wrapper around it, so a type cast hides nothing. */
function outermost(node) {
  let current = node;
  while (wrappers.has(current.parent?.type) && current.parent.expression === current) {
    current = current.parent;
  }
  return current;
}
/** Whether code reads a member of `node`, such as `matchMedia.bind`. */
const hasMember = (node) => node.parent?.type === 'MemberExpression' && node.parent.object === node;
/**
 * What code does with a `matchMedia` that is not a call with a query: a
 * local name, or a member such as `.bind`, hides the query from lint.
 */
function mediaUse(reference) {
  const media = outermost(reference);
  if (isCallee(media)) {
    return { call: media.parent };
  }
  return isAliased(media) || hasMember(media) ? { alias: media.parent, name: 'matchMedia' } : null;
}

/**
 * What code reads from the global object `owner` through `node`. Each item is
 * a width field, `{ node, read }`, a call to `matchMedia`, `{ call }`, or a
 * local name for the object or for `matchMedia`, `{ alias, name }`.
 * `window.innerWidth`, `window.screen.width` and `const { innerWidth } = window`
 * each read a width field.
 */
function fieldReads(reference, owner) {
  const node = outermost(reference);
  const { parent } = node;
  if (parent?.type === 'MemberExpression' && parent.object === node) {
    const name = propertyOf(parent);
    if (owner !== 'screen' && name === 'screen') {
      return fieldReads(parent, 'screen');
    }
    if (isWidthField(owner, name)) {
      return [{ node: parent, read: `${owner}.${name}` }];
    }
    if (owner === 'screen' || name !== 'matchMedia') {
      return [];
    }
    const use = mediaUse(parent);
    return use ? [use] : [];
  }
  if (isAliased(node)) {
    return [{ alias: parent, name: owner }];
  }
  if (
    parent?.type === 'VariableDeclarator' &&
    parent.init === node &&
    parent.id.type === 'ObjectPattern'
  ) {
    const keys = patternKeys(parent.id);
    const reads = keys
      .filter((name) => isWidthField(owner, name))
      .map((name) => ({ node: parent, read: `${owner}.${name}` }));
    return owner !== 'screen' && keys.includes('matchMedia')
      ? [...reads, { alias: parent, name: 'matchMedia' }]
      : reads;
  }
  return [];
}

const ratchets = new Map();
/**
 * The files of a repository that the ratchet holds, read once a run. Their
 * old call sites stay counted by `clutch ratchet check`, which runs this rule
 * with `REPO_LINT_ALL=1`. See
 * docs/contributing/setup/lint-rules.md#ratchet-a-rule.
 */
function ratchetedFiles(repositoryRoot) {
  if (process.env.REPO_LINT_ALL === '1') {
    return new Set();
  }
  if (!ratchets.has(repositoryRoot)) {
    const file = path.join(repositoryRoot, '.clutch/ratchets.json');
    const counts = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf-8')).ratchets?.[ratchetName]?.counts ?? {})
      : {};
    ratchets.set(repositoryRoot, new Set(Object.keys(counts)));
  }
  return ratchets.get(repositoryRoot);
}

const noViewportReads = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: { shell: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      width:
        '`{{read}}` reads the window width. A component responds to its container: use `@container` and container variants such as `@md:`. Only the app shell reads the window width. See docs/principles/mobile-first.md.',
      query:
        '`matchMedia` needs a string literal, so lint can tell whether the query reads the window width. See docs/principles/mobile-first.md.',
      alias:
        '`{{name}}` under a local name hides what it reads from lint. Read the window through `window`, and call `matchMedia` with a string literal. See docs/principles/mobile-first.md.',
    },
  },
  create(context) {
    const filename = path.resolve(context.filename ?? context.getFilename());
    const repositoryRoot = repositoryOf(filename);
    const file = path.relative(repositoryRoot, filename).split(path.sep).join('/');
    const shell = new Set(context.options[0]?.shell);
    if (shell.has(file) || isExempt(file) || ratchetedFiles(repositoryRoot).has(file)) {
      return {};
    }
    const report = (node, read) => context.report({ node, messageId: 'width', data: { read } });
    /** Checks a call to `matchMedia`, whose first argument is the query. */
    const checkQuery = (call) => {
      const query = staticText(call.arguments[0]);
      if (query === null) {
        context.report({ node: call, messageId: 'query' });
      } else if (readsWidth(query)) {
        report(call, `matchMedia('${query}')`);
      }
    };
    /** Reports what code reads from a global object, through `node`. */
    const checkObject = (node, owner) => {
      for (const item of fieldReads(node, owner)) {
        if (item.call) {
          checkQuery(item.call);
        } else if (item.alias) {
          context.report({ node: item.alias, messageId: 'alias', data: { name: item.name } });
        } else {
          report(item.node, item.read);
        }
      }
    };
    /** Local names of `useWindowDimensions` and `Dimensions` from React Native, and namespace imports of it. */
    const native = new Map();
    const namespaces = new Set();
    /** The React Native export that `node` names: `useWindowDimensions`, `RN.Dimensions`, or null. */
    const nativeExport = (node) => {
      if (node.type === 'Identifier') {
        return native.get(node.name) ?? null;
      }
      return node.type === 'MemberExpression' &&
        node.object.type === 'Identifier' &&
        namespaces.has(node.object.name)
        ? propertyOf(node)
        : null;
    };
    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'react-native' || node.importKind === 'type') {
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') {
            namespaces.add(specifier.local.name);
          } else if (specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type') {
            native.set(specifier.local.name, specifier.imported.name ?? specifier.imported.value);
          }
        }
      },
      CallExpression(node) {
        const { callee } = node;
        if (nativeExport(callee) === 'useWindowDimensions') {
          report(node, 'useWindowDimensions()');
        } else if (
          callee.type === 'MemberExpression' &&
          nativeExport(callee.object) === 'Dimensions' &&
          propertyOf(callee) === 'get'
        ) {
          report(node, 'Dimensions.get()');
        }
      },
      'Program:exit'(program) {
        // Only the references that no local name holds: the real globals. A
        // global that the parser knows, such as `globalThis`, has a variable
        // with no definition, so its references are not in `through`.
        const scope = context.sourceCode.getScope(program);
        const references = [
          ...scope.through,
          ...scope.variables
            .filter((variable) => variable.defs.length === 0)
            .flatMap((variable) => variable.references),
        ];
        for (const { identifier } of references) {
          const { name } = identifier;
          if (widthFields.has(name)) {
            report(identifier, name);
          } else if (name === 'matchMedia') {
            const use = mediaUse(identifier);
            if (use?.call) {
              checkQuery(use.call);
            } else if (use) {
              context.report({ node: use.alias, messageId: 'alias', data: { name: use.name } });
            }
          } else if (globals.has(name)) {
            checkObject(identifier, name);
          } else if (name === 'screen') {
            checkObject(identifier, 'screen');
          }
        }
      },
    };
  },
};

export default {
  meta: { name: 'repo-layout' },
  rules: { 'no-viewport-reads': noViewportReads },
};
