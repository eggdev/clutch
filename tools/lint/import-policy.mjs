import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

/** The `vi` and `jest` methods whose first argument is a module specifier. */
const mockMethods = new Set([
  'mock',
  'doMock',
  'unmock',
  'doUnmock',
  'importActual',
  'importMock',
  'requireActual',
  'requireMock',
]);

/**
 * A test runner call whose first argument is a module specifier: `vi.mock`,
 * `jest.mock`, `mock.module` and their relatives. The policy reads these
 * specifiers like imports, so a test cannot route around a boundary.
 */
export function mockCall(callee) {
  if (callee?.type !== 'MemberExpression' || callee.computed) {
    return false;
  }
  const owner = callee.object.type === 'Identifier' ? callee.object.name : null;
  const method = callee.property.name;
  return (
    (owner === 'mock' && method === 'module') ||
    (['vi', 'jest'].includes(owner) && mockMethods.has(method))
  );
}

/** Module specifiers use aliases; filesystem paths in configs are unaffected. */
function specifiers(check) {
  return {
    ImportDeclaration: (node) => check(node.source),
    ExportNamedDeclaration: (node) => check(node.source),
    ExportAllDeclaration: (node) => check(node.source),
    ImportExpression: (node) => check(node.source),
    TSImportType: (node) => check(node.source ?? node.argument?.literal ?? node.argument),
    TSExternalModuleReference: (node) => check(node.expression),
    CallExpression(node) {
      const { callee } = node;
      if (
        (callee.type === 'Identifier' && callee.name === 'require') ||
        (callee.type === 'MemberExpression' &&
          !callee.computed &&
          ((callee.object.name === 'require' && callee.property.name === 'resolve') ||
            (callee.object.name === 'module' && callee.property.name === 'require'))) ||
        mockCall(callee)
      ) {
        check(node.arguments[0]);
      }
    },
  };
}

const valueOf = (source) =>
  source?.type === 'TemplateLiteral' ? source.quasis[0]?.value.cooked : source?.value;
const filenameOf = (context) => (context.filename ?? context.getFilename()).replaceAll('\\', '/');

/** The folders a package may have. See docs/contributing/architecture/index.md#package-sections. */
export const sections = {
  types: 'public',
  config: 'private',
  models: 'public',
  commands: 'public',
  repo: 'private',
  service: 'public',
  runtime: 'apps',
  ui: 'public',
  testing: 'tests',
};
/** Sections that hold server code. Client code never imports them. */
const serverSections = new Set(['config', 'repo', 'service']);

/**
 * The repository root, tier, project and section of a linted file. `path` is
 * the path inside the project. `section` is set for package files only.
 */
export function locate(filename) {
  const match = filename.match(/^(.*?)\/(apps|features|packages|tools)\/(?:([^/]+)\/(.*))?/u);
  if (!match) {
    return null;
  }
  const [, root, tier, name, rest = ''] = match;
  const inProject = tier === 'tools' ? `${name}/${rest}` : rest;
  const first = inProject.split('/')[0];
  return {
    root,
    tier,
    name: tier === 'tools' ? undefined : name,
    path: inProject,
    section: tier === 'packages' && Object.hasOwn(sections, first) ? first : null,
  };
}

/** A `.server` module, with or without its extension. */
const isServerPath = (value) => /\.server(?:\.[cm]?[jt]sx?)?$/u.test(value);
/** What a repository specifier points at: tier, project, section and whether it is a `.server` file. */
export function targetOf(value) {
  const pkg = value.match(/^@repo\/([^/]+)\/([^/]+)(?:\/|$)/u);
  if (pkg) {
    return { tier: 'packages', name: pkg[1], section: pkg[2], server: isServerPath(value) };
  }
  const feature = value.match(/^@features\/([^/]+)\//u);
  if (feature) {
    return { tier: 'features', name: feature[1], server: isServerPath(value) };
  }
  if (value.startsWith('@/')) {
    return { tier: 'app', server: isServerPath(value) };
  }
  if (value.startsWith('@tools/')) {
    return { tier: 'tools' };
  }
  return null;
}

export const isTestFile = (filename) =>
  /(?:^|\/)test\//u.test(filename) || /\.(?:test|spec|pw)\.[cm]?[jt]sx?$/u.test(filename);
/** A specifier for one of our own modules. */
export const internal = (value) =>
  /^(?:@repo\/|@features\/|@tools\/|@\/|\.{1,2}(?:\/|$))/u.test(value);
/** A specifier that `aliases-only` rejects. */
export const notAnAlias = (value) =>
  /^(?:\.{1,2}(?:\/|$)|\/|file:|@repo\/[^/]+\/?$|@features\/[^/]+\/?$|@apps\/|~\/)/u.test(value);

const serverApps = new Map();
/** An app whose package.json has the Nx tag `platform:server`, such as `apps/api`. */
function isServerApp(root, name) {
  const file = path.join(root, 'apps', name, 'package.json');
  if (!serverApps.has(file)) {
    const tags = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')).nx?.tags ?? []) : [];
    serverApps.set(file, tags.includes('platform:server'));
  }
  return serverApps.get(file);
}

/** Whether a file runs only on the server, so it may import server code. */
function isServerFile(file, filename) {
  return (
    isTestFile(filename) ||
    isServerPath(filename.replace(/\.[cm]?[jt]sx?$/u, '')) ||
    (file.tier === 'packages' && serverSections.has(file.section)) ||
    (file.tier === 'apps' && isServerApp(file.root, file.name)) ||
    file.tier === 'tools'
  );
}

const repoTarget = (value) => value.match(/^@repo\/([^/]+)\//u)?.[1];

/** Adds each `@repo/<name>` import under `directory` to `edges`. */
function collectEdges(directory, edges) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectEdges(entryPath, edges);
    } else if (/\.[cm]?[jt]sx?$/u.test(entry.name)) {
      for (const match of readFileSync(entryPath, 'utf-8').matchAll(
        /(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*['"`]@repo\/([^/'"`]+)\//gu,
      )) {
        edges.add(match[1]);
      }
    }
  }
}

const graphs = new Map();
/** Package-to-package edges from every source and test file under `packages/`. */
function graphOf(root) {
  if (graphs.has(root)) {
    return graphs.get(root);
  }
  const graph = new Map();
  const packages = path.join(root, 'packages');
  if (existsSync(packages)) {
    for (const entry of readdirSync(packages, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const edges = new Set();
        collectEdges(path.join(packages, entry.name), edges);
        edges.delete(entry.name);
        graph.set(entry.name, edges);
      }
    }
  }
  graphs.set(root, graph);
  return graph;
}
/** The package path from `from` back to `to`, or null when there is none. */
function pathBetween(graph, from, to) {
  const queue = [[from]];
  const seen = new Set([from]);
  while (queue.length) {
    const route = queue.shift();
    for (const next of graph.get(route.at(-1)) ?? []) {
      if (next === to) {
        return [...route, next];
      }
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([...route, next]);
      }
    }
  }
  return null;
}

/** The identifier at the root of a member chain: `vi` for `vi.mock.calls`. */
function rootName(node) {
  let current = node;
  while (current?.type === 'MemberExpression') {
    current = current.object;
  }
  return current?.type === 'Identifier' ? current.name : null;
}

export const ruleNames = [
  'aliases-only',
  'tier-direction',
  'feature-isolation',
  'section-access',
  'server-only',
  'no-cycles',
  'vendor-owner',
  'languages',
  'testing-imports',
  'no-internal-mocks',
  'no-reexports',
];

/** Whether a language applies to a file, by package name, path inside a package or file pattern. */
const within = (rule, packages) => (file, filename) =>
  (file?.tier === 'packages' && packages.includes(file.name)) ||
  (file?.tier === 'packages' &&
    (rule.packagePaths ?? []).some((prefix) => file.path.startsWith(prefix))) ||
  (rule.files ?? []).some((pattern) => new RegExp(pattern, 'u').test(filename));

export const registryFile = 'docs/contributing/architecture/primitives.yaml';

/**
 * Vendor owners, languages and exceptions from the primitives registry. A vendor
 * owner is a `packages/<name>/` folder in its primitive's code roots. Inside the
 * owner, only `config/`, `repo/` and `runtime/` import the vendor, so no public
 * section shows it. See
 * docs/contributing/import-boundaries.md.
 */
export function parseRegistry(data) {
  const packagesOf = (ids) =>
    (data.primitives ?? [])
      .filter((primitive) => ids.includes(primitive.id))
      .flatMap((primitive) =>
        (primitive.code ?? []).map((root) => root.match(/^packages\/([^/]+)/u)?.[1]),
      )
      .filter(Boolean);
  return {
    vendors: (data.primitives ?? []).flatMap((primitive) => {
      const owners = packagesOf([primitive.id]);
      return (primitive.vendors ?? []).map((rule) => ({
        vendor: rule.vendor,
        pattern: new RegExp(rule.imports, 'u'),
        owner: owners.map((name) => `packages/${name}`).join('`, `'),
        allowed: (file, filename) =>
          file?.tier === 'packages' &&
          owners.includes(file.name) &&
          (['config', 'repo', 'runtime', 'testing'].includes(file.section) || isTestFile(filename)),
      }));
    }),
    languages: (data.languages ?? []).map((rule) => ({
      pattern: new RegExp(rule.imports, 'u'),
      where: rule.where,
      allowed: within(rule, packagesOf(rule.primitives ?? [])),
    })),
    exceptions: (data.exceptions ?? []).map((exception, index) => {
      const problems = [
        !ruleNames.includes(exception.rule) && `\`rule\` must be one of ${ruleNames.join(', ')}`,
        typeof exception.file !== 'string' && '`file` must be a regular expression string',
        typeof exception.imports !== 'string' && '`imports` must be a regular expression string',
        !(typeof exception.reason === 'string' && exception.reason.trim()) &&
          '`reason` must say why the import cannot move behind a boundary',
      ].filter(Boolean);
      if (problems.length) {
        throw new Error(
          `${registryFile} exceptions[${index}]: ${problems.join('; ')}. See docs/contributing/import-boundaries.md#exceptions.`,
        );
      }
      return {
        rule: exception.rule,
        file: new RegExp(exception.file, 'u'),
        imports: new RegExp(exception.imports, 'u'),
        reason: exception.reason,
      };
    }),
  };
}

const registries = new Map();
/** The parsed registry at the repository root, read once per lint run. */
/** The registry under `root` as written, or null when the file is missing. */
export function readRegistry(root) {
  const file = path.join(root, registryFile);
  return existsSync(file) ? (parse(readFileSync(file, 'utf-8')) ?? {}) : null;
}

export function registryOf(root) {
  if (!registries.has(root)) {
    registries.set(root, parseRegistry(readRegistry(root) ?? {}));
  }
  return registries.get(root);
}

/** Reports the problem, unless an exception in the registry covers this file, rule and specifier. */
function report(context, rule, descriptor, value = valueOf(descriptor.node)) {
  const filename = filenameOf(context);
  const file = locate(filename);
  const exempt =
    file &&
    registryOf(file.root).exceptions.some(
      (exception) =>
        exception.rule === rule &&
        exception.file.test(filename) &&
        exception.imports.test(typeof value === 'string' ? value : ''),
    );
  if (!exempt) {
    context.report(descriptor);
  }
}

export default {
  meta: { name: 'repo-imports' },
  rules: {
    'aliases-only': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          alias:
            'Use a path alias: `@/` inside an app, `@repo/<package>/<section>/...`, `@features/<feature>/...` or `@tools/...`. Relative paths, `@apps/` and bare package names are not allowed. See docs/contributing/import-boundaries.md#aliases.',
        },
      },
      create(context) {
        return specifiers((source) => {
          const value = valueOf(source);
          if (typeof value === 'string' && notAnAlias(value)) {
            report(context, 'aliases-only', { node: source, messageId: 'alias' });
          }
        });
      },
    },
    'tier-direction': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          package:
            'A package imports only other packages. It never imports a feature, an app or `tools/`. Inject what it needs at its interface.',
          feature:
            'A feature imports only packages and its own files. It never imports an app or `tools/`.',
          app: '`@/` is for files inside an app. Packages and features never import an app.',
        },
      },
      create(context) {
        const file = locate(filenameOf(context));
        if (!file || file.tier === 'apps' || file.tier === 'tools') {
          return {};
        }
        return specifiers((source) => {
          const value = valueOf(source);
          const target = typeof value === 'string' && targetOf(value);
          if (!target) {
            return;
          }
          if (target.tier === 'app') {
            report(context, 'tier-direction', { node: source, messageId: 'app' });
          } else if (file.tier === 'packages' && target.tier !== 'packages') {
            report(context, 'tier-direction', { node: source, messageId: 'package' });
          } else if (file.tier === 'features' && target.tier === 'tools') {
            report(context, 'tier-direction', { node: source, messageId: 'feature' });
          }
        });
      },
    },
    'feature-isolation': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          feature:
            'A feature never imports another feature. Move the shared part into a package: the design system, or the `ui/` of the package that owns the records.',
        },
      },
      create(context) {
        const file = locate(filenameOf(context));
        if (file?.tier !== 'features') {
          return {};
        }
        return specifiers((source) => {
          const value = valueOf(source);
          const target = typeof value === 'string' && targetOf(value);
          if (target?.tier === 'features' && target.name !== file.name) {
            report(context, 'feature-isolation', { node: source, messageId: 'feature' });
          }
        });
      },
    },
    'section-access': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          unknown:
            '`{{section}}` is not a package section. Use one of: {{sections}}. See docs/contributing/architecture/index.md#package-sections.',
          private:
            '`{{section}}/` is private to `packages/{{name}}`. Call its public `service/` or `types/` instead.',
          runtime:
            '`runtime/` is wiring for apps. Only an app, or its own package, imports `packages/{{name}}/runtime/`.',
        },
      },
      create(context) {
        const filename = filenameOf(context);
        const file = locate(filename);
        if (!file) {
          return {};
        }
        return specifiers((source) => {
          const value = valueOf(source);
          const target = typeof value === 'string' && targetOf(value);
          if (target?.tier !== 'packages') {
            return;
          }
          const data = { section: target.section, name: target.name };
          const own = file.tier === 'packages' && file.name === target.name;
          const access = sections[target.section];
          if (!access) {
            data.sections = Object.keys(sections).join(', ');
            report(context, 'section-access', { node: source, messageId: 'unknown', data });
          } else if (access === 'private' && !own) {
            report(context, 'section-access', { node: source, messageId: 'private', data });
          } else if (access === 'apps' && !own && file.tier !== 'apps' && !isTestFile(filename)) {
            report(context, 'section-access', { node: source, messageId: 'runtime', data });
          }
        });
      },
    },
    'server-only': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          server:
            'Client code cannot import server code (`config/`, `repo/`, `service/` or a `.server` file). Register a server change in `packages/<name>/runtime/handlers.server.ts`; a server app loads that file. See docs/contributing/import-boundaries.md#server-code.',
        },
      },
      create(context) {
        const filename = filenameOf(context);
        const file = locate(filename);
        if (!file || isServerFile(file, filename)) {
          return {};
        }
        return specifiers((source) => {
          const value = valueOf(source);
          const target = typeof value === 'string' && targetOf(value);
          if (
            target &&
            (target.server || (target.tier === 'packages' && serverSections.has(target.section)))
          ) {
            report(context, 'server-only', { node: source, messageId: 'server' });
          }
        });
      },
    },
    'no-cycles': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          cycle:
            'This import closes a package cycle: {{path}}. Move the shared code into a package that both can import.',
        },
      },
      create(context) {
        const file = locate(filenameOf(context));
        if (file?.tier !== 'packages') {
          return {};
        }
        return specifiers((source) => {
          const value = valueOf(source);
          const target = typeof value === 'string' && repoTarget(value);
          if (!target || target === file.name) {
            return;
          }
          const cycle = pathBetween(graphOf(file.root), target, file.name);
          if (cycle) {
            report(context, 'no-cycles', {
              node: source,
              messageId: 'cycle',
              data: { path: [file.name, ...cycle].join(' -> ') },
            });
          }
        });
      },
    },
    'vendor-owner': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          owner:
            '{{vendor}} is imported only in the `config/`, `repo/` or `runtime/` of `{{owner}}`. Call the service of that package. See docs/principles/generic-platform.md.',
        },
      },
      create(context) {
        const filename = filenameOf(context);
        const file = locate(filename);
        if (!file) {
          return {};
        }
        const { vendors } = registryOf(file.root);
        return specifiers((source) => {
          const value = valueOf(source);
          if (typeof value !== 'string') {
            return;
          }
          const rule = vendors.find((vendor) => vendor.pattern.test(value));
          if (rule && !rule.allowed(file, filename)) {
            report(context, 'vendor-owner', {
              node: source,
              messageId: 'owner',
              data: { vendor: rule.vendor, owner: rule.owner },
            });
          }
        });
      },
    },
    languages: {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          language:
            '`{{value}}` is imported only in {{where}}. See docs/contributing/import-boundaries.md.',
        },
      },
      create(context) {
        const filename = filenameOf(context);
        const file = locate(filename);
        if (!file) {
          return {};
        }
        const { languages } = registryOf(file.root);
        return specifiers((source) => {
          const value = valueOf(source);
          if (typeof value !== 'string') {
            return;
          }
          const rule = languages.find((language) => language.pattern.test(value));
          if (rule && !rule.allowed(file, filename)) {
            report(context, 'languages', {
              node: source,
              messageId: 'language',
              data: { value, where: rule.where },
            });
          }
        });
      },
    },
    'testing-imports': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          testing:
            '`testing/` is imported only by test files and other `testing/` files. Production code never loads fakes or Test Layers.',
        },
      },
      create(context) {
        const filename = filenameOf(context);
        if (isTestFile(filename) || locate(filename)?.section === 'testing') {
          return {};
        }
        return specifiers((source) => {
          const value = valueOf(source);
          if (typeof value === 'string' && /^@repo\/[^/]+\/testing\//u.test(value)) {
            report(context, 'testing-imports', { node: source, messageId: 'testing' });
          }
        });
      },
    },
    'no-internal-mocks': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          mock: 'Never mock our own modules. Run the real code, or provide the Test Layer of the package that owns the vendor. See docs/principles/test-the-workflow.md.',
        },
      },
      create(context) {
        const imported = new Set();
        return {
          ImportDeclaration(node) {
            if (internal(node.source.value)) {
              for (const specifier of node.specifiers) {
                imported.add(specifier.local.name);
              }
            }
          },
          CallExpression(node) {
            const { callee } = node;
            let method = null;
            if (callee.type === 'Identifier') {
              method = callee.name;
            } else if (callee.type === 'MemberExpression' && !callee.computed) {
              method = callee.property.name;
            }
            const owner = callee.type === 'MemberExpression' ? rootName(callee.object) : null;
            const [first] = node.arguments;
            const target = valueOf(first);
            if (
              ((owner === 'mock' && method === 'module') ||
                (['jest', 'vi'].includes(owner) && ['mock', 'doMock'].includes(method))) &&
              typeof target === 'string' &&
              internal(target)
            ) {
              report(context, 'no-internal-mocks', { node, messageId: 'mock' }, target);
            } else if (method === 'spyOn' && imported.has(rootName(first))) {
              report(context, 'no-internal-mocks', { node, messageId: 'mock' }, '');
            }
          },
        };
      },
    },
    'no-reexports': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          reexport:
            'A re-export gives one thing a second import path. Delete it, and import from the file that declares the thing. See docs/contributing/import-boundaries.md#aliases.',
        },
      },
      create(context) {
        const check = (node) => {
          if (node.source) {
            report(context, 'no-reexports', { node, messageId: 'reexport' }, valueOf(node.source));
          }
        };
        return { ExportNamedDeclaration: check, ExportAllDeclaration: check };
      },
    },
  },
};
