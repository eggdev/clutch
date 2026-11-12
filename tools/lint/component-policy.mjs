/**
 * The design-system lint. Product code renders the design system's components,
 * not the raw platform elements that they wrap. The list of raw elements is
 * `wrapped` below. A raw element fails only when the design system exports a
 * component for it, so the rule grows with the design system and never names a
 * component that does not exist. See
 * docs/contributing/setup/lint-rules.md#design-system-components.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Where the design system's components live, from the repository root. */
export const designSystemFolder = 'packages/design-system/ui';

/** The ratchet in `.clutch/ratchets.json` that holds old call sites. */
export const ratchetName = 'design-system-only';

/**
 * Each raw element that the design system wraps, with the components that
 * replace it, best first. `web` is a lowercase JSX element. `native` is a
 * named export of `react-native`. `inputType` picks the component for an
 * `<input>` with that literal `type`.
 */
export const wrapped = {
  web: {
    button: ['Button', 'IconButton'],
    input: ['TextField', 'Input', 'TextInput'],
    textarea: ['Textarea', 'TextArea'],
    select: ['NativeSelect', 'Select'],
    a: ['Link'],
  },
  native: {
    Pressable: ['Button', 'IconButton'],
    TouchableOpacity: ['Button', 'IconButton'],
    TouchableHighlight: ['Button', 'IconButton'],
    TouchableWithoutFeedback: ['Button', 'IconButton'],
    TouchableNativeFeedback: ['Button', 'IconButton'],
    TextInput: ['TextInput', 'Input', 'TextField'],
    Switch: ['Switch'],
    Text: ['Text'],
  },
  inputType: {
    checkbox: ['Checkbox'],
    radio: ['RadioGroup', 'Radio'],
    file: ['FileInput'],
    range: ['Slider'],
    search: ['SearchInput'],
    password: ['PasswordInput'],
  },
};

/** The names that a module exports as values. Type exports are left out. */
export function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(
    /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class)\s+(\w+)/gmu,
  )) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gmu)) {
    for (const part of match[1].split(',')) {
      const item = part.trim();
      if (item && !item.startsWith('type ')) {
        names.add(item.split(/\s+as\s+/u).pop());
      }
    }
  }
  return names;
}

/**
 * Each component that the design system exports, mapped to its import path.
 * A platform file such as `slider.native.tsx` shares the path of `slider.tsx`.
 */
export function designSystemExports(repositoryRoot) {
  const folder = path.join(repositoryRoot, designSystemFolder);
  const found = new Map();
  if (!existsSync(folder)) {
    return found;
  }
  const files = readdirSync(folder)
    .filter((file) => /\.tsx?$/u.test(file) && !/\.(?:test|spec)\.tsx?$/u.test(file))
    .toSorted();
  for (const file of files) {
    const module = file.replace(/(?:\.(?:native|web|ios|android))?\.tsx?$/u, '');
    for (const name of exportedNames(readFileSync(path.join(folder, file), 'utf-8'))) {
      if (!found.has(name)) {
        found.set(name, `@repo/design-system/ui/${module}`);
      }
    }
  }
  return found;
}

/** The first component in `candidates` that the design system exports, or null. */
export function replacement(candidates, exports) {
  const name = (candidates ?? []).find((candidate) => exports.has(candidate));
  return name ? { name, from: exports.get(name) } : null;
}

/** Files that may render raw elements: the design system itself and tests. */
export function isExempt(file) {
  return (
    file.startsWith(`${designSystemFolder.split('/').slice(0, 2).join('/')}/`) ||
    /(?:^|\/)(?:test|testing)\//u.test(file) ||
    /\.(?:test|spec|pw|journey)\.[cm]?[jt]sx?$/u.test(file)
  );
}

/**
 * The files that the ratchet holds. Their old call sites stay counted by
 * `clutch ratchet check`, which runs this rule with `REPO_LINT_ALL=1`.
 */
function ratchetedFiles(repositoryRoot) {
  if (process.env.REPO_LINT_ALL === '1') {
    return new Set();
  }
  const file = path.join(repositoryRoot, '.clutch/ratchets.json');
  if (!existsSync(file)) {
    return new Set();
  }
  const counts = JSON.parse(readFileSync(file, 'utf-8')).ratchets?.[ratchetName]?.counts ?? {};
  return new Set(Object.keys(counts));
}

const literalType = (node) => {
  const attribute = node.attributes.find(
    (item) => item.type === 'JSXAttribute' && item.name?.name === 'type',
  );
  return attribute?.value?.type === 'Literal' ? attribute.value.value : null;
};

const roots = new Map();
/**
 * The repository that holds a file: the nearest folder whose `package.json`
 * declares workspaces. Lint can run from any folder, so the rule does not
 * trust the working directory.
 */
export function repositoryOf(file) {
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

const states = new Map();
/** The design system's exports and the ratchet of one repository, read once a run. */
function state(repositoryRoot) {
  if (!states.has(repositoryRoot)) {
    states.set(repositoryRoot, {
      exports: designSystemExports(repositoryRoot),
      ratcheted: ratchetedFiles(repositoryRoot),
    });
  }
  return states.get(repositoryRoot);
}

const useDesignSystem = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      raw: '`<{{element}}>` is a raw {{platform}} element that the design system wraps. Use `{{component}}` from `{{from}}`. See docs/contributing/setup/lint-rules.md#design-system-components.',
    },
  },
  create(context) {
    const filename = path.resolve(context.filename ?? context.getFilename());
    const repositoryRoot = repositoryOf(filename);
    const file = path.relative(repositoryRoot, filename).split(path.sep).join('/');
    const { exports, ratcheted } = state(repositoryRoot);
    if (isExempt(file) || ratcheted.has(file) || exports.size === 0) {
      return {};
    }
    /** Local names bound to a `react-native` export, and namespace imports of it. */
    const native = new Map();
    const namespaces = new Set();
    const report = (node, element, platform, candidates) => {
      const found = replacement(candidates, exports);
      if (found) {
        context.report({
          node,
          messageId: 'raw',
          data: { element, platform, component: found.name, from: found.from },
        });
      }
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
      JSXOpeningElement(node) {
        const { name } = node;
        if (name.type === 'JSXIdentifier') {
          if (native.has(name.name)) {
            const imported = native.get(name.name);
            report(node, name.name, 'React Native', wrapped.native[imported]);
          } else if (Object.hasOwn(wrapped.web, name.name)) {
            const byType = name.name === 'input' ? wrapped.inputType[literalType(node)] : null;
            const candidates = replacement(byType, exports) ? byType : wrapped.web[name.name];
            report(node, name.name, 'web', candidates);
          }
        } else if (
          name.type === 'JSXMemberExpression' &&
          name.object.type === 'JSXIdentifier' &&
          namespaces.has(name.object.name)
        ) {
          report(
            node,
            `${name.object.name}.${name.property.name}`,
            'React Native',
            wrapped.native[name.property.name],
          );
        }
      },
    };
  },
};

export default {
  meta: { name: 'repo-components' },
  rules: { 'design-system-only': useDesignSystem },
};
