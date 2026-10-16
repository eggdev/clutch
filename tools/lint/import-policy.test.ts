import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  mockCall,
  notAnAlias,
  parseRegistry,
  registryFile,
  registryOf,
} from '@tools/lint/import-policy.mjs';
import { stringify } from 'yaml';

const root = path.resolve(import.meta.dir, '../..');

/** Writes the files into a new directory, lints it, and lists `path rule` for each diagnostic. */
async function lint(files: Record<string, string>): Promise<Array<string>> {
  const directory = await mkdtemp(path.join(tmpdir(), 'import-rule-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      await mkdir(path.resolve(directory, name, '..'), { recursive: true });
      await writeFile(path.join(directory, name), source);
    }
    const run = Bun.spawnSync([
      path.resolve(root, 'node_modules/.bin/oxlint'),
      '-c',
      path.resolve(root, 'oxlint.config.ts'),
      '--format',
      'json',
      directory,
    ]);
    const result = JSON.parse(run.stdout.toString());
    const lines: Array<string> = result.diagnostics
      .filter((item: { code: string }) => item.code.startsWith('repo-imports('))
      .map(
        (item: { code: string; filename: string }) =>
          `${path.relative(directory, item.filename)} ${item.code.replace(/^repo-imports\((.+)\)$/u, '$1')}`,
      );
    return lines.toSorted();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
/** A primitive whose code root is `packages/<id>/`. */
const primitive = (id: string, vendors: Array<{ vendor: string; imports: string }> = []) => ({
  id,
  group: 'platform',
  name: id,
  kind: 'service',
  summary: `The ${id} service.`,
  code: [`packages/${id}/`],
  docs: [],
  vendors,
});
/** A filled primitives registry, as kickoff writes it for a project. */
const registry = {
  version: 1,
  groups: [{ id: 'platform', name: 'Platform' }],
  primitives: [
    primitive('sync', [{ vendor: 'Automerge', imports: '^@automerge/' }]),
    primitive('identity', [
      {
        vendor: 'Better Auth',
        imports: '^(?:@better-auth/|better-auth(?:/|$)|better-call(?:/|$))',
      },
    ]),
    primitive('billing', [{ vendor: 'Stripe', imports: '^stripe(?:/|$)' }]),
    primitive('document-extraction', [{ vendor: 'unpdf', imports: '^unpdf(?:/|$)' }]),
    primitive('storage'),
    primitive('design-system'),
  ],
  layers: [
    {
      imports: '^drizzle-orm(?:/|$)',
      where: '`src/server/db/**` and `@repo/storage`',
      primitives: ['storage'],
      packagePaths: ['src/server/db/'],
    },
    {
      imports: '^one(?:/|$)',
      where: '`apps/app/app/**` and the config files in `apps/app/`',
      files: ['/apps/app/app/', '/apps/app/[^/]+\\.config\\.[cm]?[jt]s$'],
    },
    {
      imports: '^react(?:-native)?(?:/|$)',
      where: '`src/ui/**`, `@repo/design-system` and `apps/app`',
      primitives: ['design-system'],
      packagePaths: ['src/ui/'],
      files: ['/apps/app/'],
    },
  ],
  invariants: [],
};
const registryYaml = stringify(registry);
const tagged = (kind: string) => JSON.stringify({ nx: { tags: [`type:${kind}`] } });

test('Oxlint rejects relative static, type, re-export, dynamic and CommonJS imports', async () => {
  expect(
    await lint({
      'bad.ts': [
        'import "./side-effect";',
        'export { value } from "../parent";',
        'export * from "./exports";',
        'export const lazy = import("./dynamic");',
        'export type Item = import("./types").Item;',
        'export const common = require("../common");',
        'export const resolved = require.resolve("./resolved");',
        'import legacy = require("./legacy"); export { legacy };',
        'export const template = import(`./template`);',
        'import "@repo/projects";',
      ].join('\n'),
    }),
  ).toEqual(Array.from({ length: 10 }, () => 'bad.ts aliases-only'));
  expect(
    await lint({
      'clean.ts':
        'import "@/lib/auth-context"; import "@repo/sync/src/server"; import "@tools/lint/check-manifests"; import "node:fs";',
    }),
  ).toEqual([]);
});

test('packages never import apps or tools, and client and contract files stay portable', async () => {
  const packages = {
    'packages/access/package.json': tagged('service'),
    'packages/sync/package.json': tagged('service'),
    'packages/projects/package.json': tagged('domain'),
  };
  expect(
    await lint({
      ...packages,
      'packages/projects/src/server.ts':
        'import "@apps/api/worker"; import "@tools/lint/check-manifests"; import "@/lib/auth-platform";',
      'packages/projects/src/client.ts':
        'import "@repo/projects/src/server"; import "@repo/access/src/sqlite"; import "node:fs";',
      'packages/sync/src/contracts.ts': 'import "@repo/sync/src/server";',
      'apps/app/lib/project.ts':
        'export * from "@repo/projects/src/server.ts"; import "@apps/api/worker";',
    }),
  ).toEqual([
    'apps/app/lib/project.ts module-dependencies',
    'apps/app/lib/project.ts module-dependencies',
    'packages/projects/src/client.ts module-dependencies',
    'packages/projects/src/client.ts module-dependencies',
    'packages/projects/src/client.ts module-dependencies',
    'packages/projects/src/server.ts module-dependencies',
    'packages/projects/src/server.ts module-dependencies',
    'packages/projects/src/server.ts module-dependencies',
    'packages/sync/src/contracts.ts module-dependencies',
  ]);
  expect(
    await lint({
      ...packages,
      'packages/projects/src/server.ts': 'import "@repo/access/src/sqlite"; import "node:fs";',
      'packages/projects/src/client.ts': 'import "@repo/projects/src/contracts";',
      'packages/sync/src/contracts.ts': 'export type Scalar = string | number | boolean | null;',
      'apps/app/lib/project.ts': 'import "@repo/projects/src/client";',
    }),
  ).toEqual([]);
});

test('a service never imports a domain, a domain never imports another domain, and each package is tagged', async () => {
  const packages = {
    'packages/access/package.json': tagged('service'),
    'packages/sync/package.json': tagged('service'),
    'packages/projects/package.json': tagged('domain'),
    'packages/billing/package.json': tagged('domain'),
    'packages/untagged/package.json': '{}',
  };
  expect(
    await lint({
      ...packages,
      'packages/access/src/server.ts': 'import "@repo/projects/src/contracts";',
      'packages/projects/src/server.ts': 'import "@repo/billing/src/plans";',
      'packages/sync/src/server.ts': 'import "@repo/untagged/src/thing";',
    }),
  ).toEqual([
    'packages/access/src/server.ts module-direction',
    'packages/projects/src/server.ts module-direction',
    'packages/sync/src/server.ts module-direction',
  ]);
  expect(
    await lint({
      ...packages,
      'packages/access/src/server.ts': 'import "@repo/sync/src/server";',
      'packages/projects/src/server.ts':
        'import "@repo/access/src/server"; import "@repo/projects/src/contracts";',
      'apps/api/worker.ts': 'import "@repo/projects/src/server"; import "@repo/billing/src/plans";',
    }),
  ).toEqual([]);
});

test('an import that closes a package cycle fails at each end, and passes once the cycle is gone', async () => {
  const packages = {
    'packages/access/package.json': tagged('service'),
    'packages/sync/package.json': tagged('service'),
    'packages/storage/package.json': tagged('service'),
  };
  expect(
    await lint({
      ...packages,
      'packages/access/src/server.ts': 'import "@repo/sync/src/server";',
      'packages/sync/src/server.ts': 'import "@repo/storage/src/connection";',
      'packages/storage/test/connection.test.ts': 'import "@repo/access/src/server";',
    }),
  ).toEqual([
    'packages/access/src/server.ts no-cycles',
    'packages/storage/test/connection.test.ts no-cycles',
    'packages/sync/src/server.ts no-cycles',
  ]);
  expect(
    await lint({
      ...packages,
      'packages/access/src/server.ts': 'import "@repo/sync/src/server";',
      'packages/sync/src/server.ts': 'import "@repo/storage/src/connection";',
      'packages/storage/test/connection.test.ts': 'import "@repo/storage/src/connection";',
    }),
  ).toEqual([]);
});

test('vendor and layer rules do nothing until the registry names them', async () => {
  expect(
    await lint({
      'packages/projects/src/server.ts': 'import "stripe"; import "drizzle-orm"; import "react";',
    }),
  ).toEqual([]);
});

test('a vendor is imported only in its owner module', async () => {
  expect(
    await lint({
      [registryFile]: registryYaml,
      'packages/projects/src/server.ts':
        'import "better-auth"; import "@better-auth/core"; import "better-call"; import "stripe"; import "unpdf";',
      'apps/api/worker.ts': 'import "@automerge/automerge"; import "better-auth/plugins";',
    }),
  ).toEqual([
    'apps/api/worker.ts vendor-owner',
    'apps/api/worker.ts vendor-owner',
    'packages/projects/src/server.ts vendor-owner',
    'packages/projects/src/server.ts vendor-owner',
    'packages/projects/src/server.ts vendor-owner',
    'packages/projects/src/server.ts vendor-owner',
    'packages/projects/src/server.ts vendor-owner',
  ]);
  expect(
    await lint({
      [registryFile]: registryYaml,
      'packages/identity/src/server/runtime.ts': 'import "better-auth"; import "better-call";',
      'packages/identity/test/runtime.test.ts': 'import "@better-auth/memory-adapter";',
      'packages/sync/src/server.ts': 'import "@automerge/automerge";',
      'packages/billing/src/server/stripe.ts': 'import "stripe";',
      'packages/document-extraction/src/server/pdf.ts': 'import "unpdf";',
    }),
  ).toEqual([]);
});

test('drizzle-orm, one and react are imported only in their layers', async () => {
  expect(
    await lint({
      [registryFile]: registryYaml,
      'packages/projects/src/server/model.ts': 'import "drizzle-orm"; import "react";',
      'apps/api/worker.ts': 'import "drizzle-orm/d1";',
      'apps/app/lib/gate.tsx': 'import "one";',
      'packages/projects/src/ui/workspace.tsx': 'import "one";',
      'packages/identity/src/server.ts': 'import "react-native";',
    }),
  ).toEqual([
    'apps/api/worker.ts layers',
    'apps/app/lib/gate.tsx layers',
    'packages/identity/src/server.ts layers',
    'packages/projects/src/server/model.ts layers',
    'packages/projects/src/server/model.ts layers',
    'packages/projects/src/ui/workspace.tsx layers',
  ]);
  expect(
    await lint({
      [registryFile]: registryYaml,
      'packages/projects/src/server/db/schema.ts': 'import "drizzle-orm/sqlite-core";',
      'packages/storage/src/server/d1.ts': 'import "drizzle-orm/d1";',
      'apps/app/app/_layout.tsx': 'import "one"; import "react";',
      'apps/app/vite.config.ts': 'import "one/vite";',
      'apps/app/react-native.config.cjs': 'require("one/react-native-commands");',
      'apps/app/lib/gate.tsx': 'import "react"; import "react-native";',
      'packages/projects/src/ui/workspace.tsx': 'import "react"; import "react-native";',
      'packages/design-system/src/button.tsx': 'import "react-native";',
    }),
  ).toEqual([]);
});

test('src/testing is imported only by test files and other src/testing files', async () => {
  const packages = {
    'packages/sync/package.json': tagged('service'),
    'packages/projects/package.json': tagged('domain'),
  };
  expect(
    await lint({
      ...packages,
      'packages/projects/src/server.ts': 'import "@repo/sync/src/testing/fake-transport";',
      'apps/api/worker.ts': 'import "@repo/projects/src/testing/project";',
    }),
  ).toEqual([
    'apps/api/worker.ts testing-imports',
    'packages/projects/src/server.ts testing-imports',
  ]);
  expect(
    await lint({
      ...packages,
      'packages/projects/test/sync.test.ts': 'import "@repo/sync/src/testing/fake-transport";',
      'packages/projects/src/testing/project.ts': 'import "@repo/sync/src/testing/fake-transport";',
      'apps/api/browser/onboarding.pw.ts': 'import "@repo/projects/src/testing/project";',
    }),
  ).toEqual([]);
});

test('every rule reads vi.mock, jest.mock and mock.module specifiers like imports', async () => {
  expect(
    await lint({
      [registryFile]: registryYaml,
      'packages/projects/package.json': tagged('domain'),
      'packages/sync/package.json': tagged('service'),
      'packages/projects/test/sync.test.ts': [
        'vi.mock("./relative");',
        'vi.mock("stripe");',
        'jest.requireActual("../parent");',
        'mock.module("drizzle-orm", () => ({}));',
        'vi.mock("@repo/sync/src/server");',
        'vi.importActual("@repo/sync/src/server");',
      ].join('\n'),
    }),
  ).toEqual([
    'packages/projects/test/sync.test.ts aliases-only',
    'packages/projects/test/sync.test.ts aliases-only',
    'packages/projects/test/sync.test.ts layers',
    'packages/projects/test/sync.test.ts no-internal-mocks',
    'packages/projects/test/sync.test.ts no-internal-mocks',
    'packages/projects/test/sync.test.ts vendor-owner',
  ]);
  expect(
    mockCall({
      type: 'MemberExpression',
      computed: false,
      object: { type: 'Identifier', name: 'vi' },
      property: { name: 'unmock' },
    }),
  ).toBe(true);
  expect(
    mockCall({
      type: 'MemberExpression',
      computed: false,
      object: { type: 'Identifier', name: 'vi' },
      property: { name: 'fn' },
    }),
  ).toBe(false);
  expect(
    ['./x', '../x', '@repo/sync', '/abs', '@repo/sync/src/server', 'stripe'].filter(notAnAlias),
  ).toEqual(['./x', '../x', '@repo/sync', '/abs']);
});

test('an exception lets one file import one specifier past one rule, and needs a reason', async () => {
  const exception = {
    rule: 'vendor-owner',
    file: '/packages/projects/src/server/legacy-billing\\.ts$',
    imports: '^stripe$',
    reason: 'The legacy webhook verifies its signature before billing exposes a port for it.',
  };
  const withException = stringify({ ...registry, exceptions: [exception] });
  expect(
    await lint({
      [registryFile]: withException,
      'packages/projects/src/server/legacy-billing.ts': 'import "stripe"; import "drizzle-orm";',
      'packages/projects/src/server/invoices.ts': 'import "stripe";',
    }),
  ).toEqual([
    'packages/projects/src/server/invoices.ts vendor-owner',
    'packages/projects/src/server/legacy-billing.ts layers',
  ]);
  expect(() => parseRegistry({ exceptions: [{ ...exception, reason: ' ' }] })).toThrow(
    'docs/contributing/architecture/primitives.yaml exceptions[0]: `reason` must say why the import cannot move behind a boundary.',
  );
  expect(() => parseRegistry({ exceptions: [{ ...exception, rule: 'vendor' }] })).toThrow(
    '`rule` must be one of aliases-only',
  );
});

test('each exception in this repository states its reason', () => {
  for (const exception of registryOf(root).exceptions) {
    expect(exception.reason.trim()).not.toBe('');
  }
});
