import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
      const callee = node.callee;
      if (
        (callee.type === 'Identifier' && callee.name === 'require') ||
        (callee.type === 'MemberExpression' &&
          !callee.computed &&
          ((callee.object.name === 'require' && callee.property.name === 'resolve') ||
            (callee.object.name === 'module' && callee.property.name === 'require')))
      )
        check(node.arguments[0]);
    },
  };
}
const valueOf = (source) =>
  source?.type === 'TemplateLiteral' ? source.quasis[0]?.value.cooked : source?.value;
const filenameOf = (context) => (context.filename ?? context.getFilename()).replaceAll('\\', '/');

/** The repository root and package of a linted file. */
function locate(filename) {
  const match = filename.match(/^(.*?)\/(?:packages\/([^/]+)\/(.*)|apps\/|tools\/)/);
  return match ? { root: match[1], name: match[2], path: match[3] } : null;
}
const repoTarget = (value) => value.match(/^@repo\/([^/]+)\//)?.[1];
const isTestFile = (filename) =>
  /(?:^|\/)test\//.test(filename) || /\.(?:test|spec|pw)\.[cm]?[jt]sx?$/.test(filename);
const internal = (value) => /^(?:@repo\/|@apps\/|@tools\/|@\/|\.{1,2}(?:\/|$))/.test(value);

const kinds = new Map();
/** Reads `type:service` or `type:domain` from the package manifest. */
function kindOf(root, name) {
  const file = join(root, 'packages', name, 'package.json');
  if (!kinds.has(file)) {
    const tags = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).nx?.tags ?? []) : [];
    const kind = tags.filter((tag) => tag === 'type:service' || tag === 'type:domain');
    kinds.set(file, kind.length === 1 ? kind[0].slice(5) : null);
  }
  return kinds.get(file);
}

const graphs = new Map();
/** Package-to-package edges from every source and test file under `packages/`. */
function graphOf(root) {
  if (graphs.has(root)) return graphs.get(root);
  const graph = new Map();
  const packages = join(root, 'packages');
  const walk = (directory, edges) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path, edges);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name))
        for (const match of readFileSync(path, 'utf8').matchAll(
          /(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*['"`]@repo\/([^/'"`]+)\//g,
        ))
          edges.add(match[1]);
    }
  };
  if (existsSync(packages))
    for (const entry of readdirSync(packages, { withFileTypes: true }))
      if (entry.isDirectory()) {
        const edges = new Set();
        walk(join(packages, entry.name), edges);
        edges.delete(entry.name);
        graph.set(entry.name, edges);
      }
  graphs.set(root, graph);
  return graph;
}
/** The package path from `from` back to `to`, or null when there is none. */
function pathBetween(graph, from, to) {
  const queue = [[from]];
  const seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift();
    for (const next of graph.get(path.at(-1)) ?? []) {
      if (next === to) return [...path, next];
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return null;
}

const boundaries = new Map();
/**
 * Vendor owners and layers from `tools/lint/boundaries.json` at the repository
 * root. See docs/principles/generic-platform.md and
 * docs/contributing/import-boundaries.md.
 */
function boundariesOf(root) {
  if (!boundaries.has(root)) {
    const file = join(root, 'tools/lint/boundaries.json');
    const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    const within = (rule, file, filename) =>
      (rule.packages ?? []).includes(file?.name) ||
      (!!file?.name && (rule.packagePaths ?? []).some((path) => file.path.startsWith(path))) ||
      (rule.files ?? []).some((pattern) => new RegExp(pattern).test(filename));
    boundaries.set(root, {
      vendors: (data.vendors ?? []).map((rule) => ({
        vendor: rule.vendor,
        pattern: new RegExp(rule.imports),
        owner: `packages/${rule.owner}`,
        allowed: (file) => file?.name === rule.owner,
      })),
      layers: (data.layers ?? []).map((rule) => ({
        pattern: new RegExp(rule.imports),
        where: rule.where,
        allowed: (file, filename) => within(rule, file, filename),
      })),
    });
  }
  return boundaries.get(root);
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
          if (
            typeof value === 'string' &&
            /^(?:\.{1,2}(?:\/|$)|\/|file:|@repo\/[^/]+$|~\/)/.test(value)
          )
            context.report({ node: source, messageId: 'alias' });
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
            'Client and domain modules cannot import server implementations or infrastructure. Use a plain contract or inject an adapter.',
        },
      },
      create(context) {
        const filename = filenameOf(context);
        const pkg = filename.match(/(?:^|\/)packages\/([^/]+)\/src\/(.+)$/);
        const browser = /(?:^|\/)apps\/app\/(?:lib|app)\//.test(filename);
        const portable = pkg && /^(?:client|http)(?:\/|\.)/.test(pkg[2]) && pkg[1] !== 'access';
        const domain =
          pkg &&
          ((pkg[1] === 'projects' &&
            /^(?:contracts|model|events|intake|change-orders|errors)\.ts$/.test(pkg[2])) ||
            (pkg[1] === 'access' && /^(?:index\.ts|lib\/)/.test(pkg[2])) ||
            (pkg[1] === 'sync' && pkg[2] === 'contracts.ts'));
        return specifiers((source) => {
          const value = valueOf(source);
          if (typeof value !== 'string') return;
          if (pkg && /^@(?:apps|tools)?\//.test(value)) {
            context.report({ node: source, messageId: 'application' });
            return;
          }
          if (
            (browser || portable || domain) &&
            ((browser && /^@(?:apps|tools)\//.test(value)) ||
              /^@repo\/[^/]+\/src\/server(?:\/|\.|$)/.test(value) ||
              /^@repo\/access\/src\/(?:sqlite|http)(?:\/|\.|$)/.test(value) ||
              /^(?:@automerge\/|@better-auth\/|better-auth(?:\/|$)|better-call(?:\/|$)|@cloudflare\/|wrangler(?:\/|$))/.test(
                value,
              ) ||
              ((portable || domain) &&
                /^(?:node:|bun:|react(?:-native)?(?:\/|$)|expo(?:-|\/|$)|one(?:\/|$))/.test(value)))
          )
            context.report({ node: source, messageId: 'portable' });
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
        if (!file?.name) return {};
        return specifiers((source) => {
          const value = valueOf(source);
          const target = typeof value === 'string' && repoTarget(value);
          if (!target || target === file.name) return;
          for (const name of [file.name, target])
            if (!kindOf(file.root, name)) {
              context.report({ node: source, messageId: 'untagged', data: { name } });
              return;
            }
          if (kindOf(file.root, target) !== 'domain') return;
          context.report({ node: source, messageId: kindOf(file.root, file.name) });
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
        if (!file?.name) return {};
        return specifiers((source) => {
          const value = valueOf(source);
          const target = typeof value === 'string' && repoTarget(value);
          if (!target || target === file.name) return;
          const path = pathBetween(graphOf(file.root), target, file.name);
          if (path)
            context.report({
              node: source,
              messageId: 'cycle',
              data: { path: [file.name, ...path].join(' -> ') },
            });
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
        if (!file) return {};
        const { vendors } = boundariesOf(file.root);
        return specifiers((source) => {
          const value = valueOf(source);
          if (typeof value !== 'string') return;
          const rule = vendors.find((vendor) => vendor.pattern.test(value));
          if (rule && !rule.allowed(file ?? {}))
            context.report({
              node: source,
              messageId: 'owner',
              data: { vendor: rule.vendor, owner: rule.owner },
            });
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
        if (!file) return {};
        const { layers } = boundariesOf(file.root);
        return specifiers((source) => {
          const value = valueOf(source);
          if (typeof value !== 'string') return;
          const rule = layers.find((layer) => layer.pattern.test(value));
          if (rule && !rule.allowed(file, filename))
            context.report({
              node: source,
              messageId: 'layer',
              data: { value, where: rule.where },
            });
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
        if (isTestFile(filename) || /\/src\/testing\//.test(filename)) return {};
        return specifiers((source) => {
          const value = valueOf(source);
          if (typeof value === 'string' && /^@repo\/[^/]+\/src\/testing\//.test(value))
            context.report({ node: source, messageId: 'testing' });
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
        const rootName = (node) => {
          while (node?.type === 'MemberExpression') node = node.object;
          return node?.type === 'Identifier' ? node.name : null;
        };
        return {
          ImportDeclaration(node) {
            if (internal(node.source.value))
              for (const specifier of node.specifiers) imported.add(specifier.local.name);
          },
          CallExpression(node) {
            const callee = node.callee;
            const method =
              callee.type === 'Identifier'
                ? callee.name
                : callee.type === 'MemberExpression' && !callee.computed
                  ? callee.property.name
                  : null;
            const owner = callee.type === 'MemberExpression' ? rootName(callee.object) : null;
            const [first] = node.arguments;
            const target = valueOf(first);
            if (
              ((owner === 'mock' && method === 'module') ||
                (['jest', 'vi'].includes(owner) && ['mock', 'doMock'].includes(method))) &&
              typeof target === 'string' &&
              internal(target)
            )
              context.report({ node, messageId: 'mock' });
            else if (method === 'spyOn' && imported.has(rootName(first)))
              context.report({ node, messageId: 'mock' });
          },
        };
      },
    },
  },
};
