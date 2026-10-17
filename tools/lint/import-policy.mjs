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

/** The repository root and package of a linted file. */
function locate(filename) {
  const match = filename.match(/^(.*?)\/(?:packages\/([^/]+)\/(.*)|apps\/|tools\/)/u);
  return match ? { root: match[1], name: match[2], path: match[3] } : null;
}
/** Framework and platform runtimes. Client and contract files stay plain TypeScript. */
const runtimes =
  /^(?:node:|bun:|cloudflare:|@cloudflare\/|wrangler(?:\/|$)|react(?:-dom|-native)?(?:\/|$)|next(?:\/|$)|expo(?:-|\/|$)|one(?:\/|$))/u;
const repoTarget = (value) => value.match(/^@repo\/([^/]+)\//u)?.[1];
export const isTestFile = (filename) =>
  /(?:^|\/)test\//u.test(filename) || /\.(?:test|spec|pw)\.[cm]?[jt]sx?$/u.test(filename);
/** A specifier for one of our own modules. */
export const internal = (value) => /^(?:@repo\/|@apps\/|@tools\/|@\/|\.{1,2}(?:\/|$))/u.test(value);
/** A specifier that `aliases-only` rejects. */
export const notAnAlias = (value) => /^(?:\.{1,2}(?:\/|$)|\/|file:|@repo\/[^/]+$|~\/)/u.test(value);

const kinds = new Map();
/** Reads `type:service` or `type:domain` from the package manifest. */
function kindOf(root, name) {
  const file = path.join(root, 'packages', name, 'package.json');
  if (!kinds.has(file)) {
    const tags = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')).nx?.tags ?? []) : [];
    const kind = tags.filter((tag) => tag === 'type:service' || tag === 'type:domain');
    kinds.set(file, kind.length === 1 ? kind[0].slice(5) : null);
  }
  return kinds.get(file);
}

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
  'module-dependencies',
  'module-direction',
  'no-cycles',
  'vendor-owner',
  'layers',
  'testing-imports',
  'no-internal-mocks',
];

/** Whether a layer applies to a file, by package name, package path or file pattern. */
const within = (rule, packages) => (file, filename) =>
  packages.includes(file?.name) ||
  (!!file?.name && (rule.packagePaths ?? []).some((prefix) => file.path.startsWith(prefix))) ||
  (rule.files ?? []).some((pattern) => new RegExp(pattern, 'u').test(filename));

export const registryFile = 'docs/contributing/architecture/primitives.yaml';

/**
 * Vendor owners, layers and exceptions from the primitives registry. A vendor
 * owner is a `packages/<name>/` folder in its primitive's code roots. See
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
        allowed: (file) => owners.includes(file?.name),
      }));
    }),
    layers: (data.layers ?? []).map((rule) => ({
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
            'Use a TypeScript path alias (@/, @apps/, @repo/, or @tools/) for repository imports. Relative paths and workspace package entrypoints are not allowed.',
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
    'module-dependencies': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          application:
            'Packages cannot depend on applications or repository tooling. Inject an adapter at the module interface.',
          portable:
            'Client and contract files cannot import server code, vendors or framework runtimes. Use a plain contract or inject an adapter.',
        },
      },
      create(context) {
        const filename = filenameOf(context);
        const file = locate(filename);
        const pkg = filename.match(/(?:^|\/)packages\/([^/]+)\/src\/(.+)$/u);
        // `src/client.ts` and `src/contracts.ts`, or a folder of the same name.
        const portable = pkg && /^(?:client|contracts)(?:\/|\.)/u.test(pkg[2]);
        const vendors = portable && file ? registryOf(file.root).vendors : [];
        return specifiers((source) => {
          const value = valueOf(source);
          if (typeof value !== 'string') {
            return;
          }
          if (pkg && /^@(?:apps|tools)?\//u.test(value)) {
            report(context, 'module-dependencies', { node: source, messageId: 'application' });
            return;
          }
          if (
            portable &&
            (/^@repo\/[^/]+\/src\/server(?:\/|\.|$)/u.test(value) ||
              runtimes.test(value) ||
              vendors.some((vendor) => vendor.pattern.test(value)))
          ) {
            report(context, 'module-dependencies', { node: source, messageId: 'portable' });
          }
        });
      },
    },
    'module-direction': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          untagged:
            '`packages/{{name}}` needs exactly one Nx tag, `type:service` or `type:domain`, in its package.json.',
          service:
            'A service never imports a domain. Move the shared behavior into a service, or compose both in the app.',
          domain:
            'A domain never imports another domain. Move the shared behavior into a service, or compose both in the app.',
        },
      },
      create(context) {
        const file = locate(filenameOf(context));
        if (!file?.name) {
          return {};
        }
        return specifiers((source) => {
          const value = valueOf(source);
          const target = typeof value === 'string' && repoTarget(value);
          if (!target || target === file.name) {
            return;
          }
          for (const name of [file.name, target]) {
            if (!kindOf(file.root, name)) {
              report(context, 'module-direction', {
                node: source,
                messageId: 'untagged',
                data: { name },
              });
              return;
            }
          }
          if (kindOf(file.root, target) !== 'domain') {
            return;
          }
          report(context, 'module-direction', {
            node: source,
            messageId: kindOf(file.root, file.name),
          });
        });
      },
    },
    'no-cycles': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          cycle:
            'This import closes a package cycle: {{path}}. Move the shared code into a service that both can import.',
        },
      },
      create(context) {
        const file = locate(filenameOf(context));
        if (!file?.name) {
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
            '{{vendor}} is imported only in `{{owner}}`. Ask the owner module for the capability. See docs/principles/generic-platform.md.',
        },
      },
      create(context) {
        const file = locate(filenameOf(context));
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
          if (rule && !rule.allowed(file ?? {})) {
            report(context, 'vendor-owner', {
              node: source,
              messageId: 'owner',
              data: { vendor: rule.vendor, owner: rule.owner },
            });
          }
        });
      },
    },
    layers: {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          layer:
            '`{{value}}` is imported only in {{where}}. See docs/contributing/import-boundaries.md.',
        },
      },
      create(context) {
        const filename = filenameOf(context);
        const file = locate(filename);
        if (!file) {
          return {};
        }
        const { layers } = registryOf(file.root);
        return specifiers((source) => {
          const value = valueOf(source);
          if (typeof value !== 'string') {
            return;
          }
          const rule = layers.find((layer) => layer.pattern.test(value));
          if (rule && !rule.allowed(file, filename)) {
            report(context, 'layers', {
              node: source,
              messageId: 'layer',
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
            '`src/testing/**` is imported only by test files and other `src/testing/` files. Production code never loads test builders or fakes.',
        },
      },
      create(context) {
        const filename = filenameOf(context);
        if (isTestFile(filename) || /\/src\/testing\//u.test(filename)) {
          return {};
        }
        return specifiers((source) => {
          const value = valueOf(source);
          if (typeof value === 'string' && /^@repo\/[^/]+\/src\/testing\//u.test(value)) {
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
          mock: 'Never mock our own modules. Run the real code, or connect a vendor fake through the owner module port. See docs/principles/test-the-workflow.md.',
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
  },
};
