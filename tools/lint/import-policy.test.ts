import { expect, test } from 'bun:test';
import path from 'node:path';

import {
  mockCall,
  notAnAlias,
  parseRegistry,
  registryFile,
  registryOf,
} from '@tools/lint/import-policy.mjs';
import { lint } from '@tools/testing/lint-imports';
import { stringify } from 'yaml';

const root = path.resolve(import.meta.dir, '../..');

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
  languages: [
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
  ).toEqual([
    ...Array.from({ length: 10 }, () => 'bad.ts aliases-only'),
    'bad.ts no-reexports',
    'bad.ts no-reexports',
  ]);
  expect(
    await lint({
      'clean.ts':
        'import "@/lib/auth-context"; import "@repo/sync/src/server"; import "@tools/lint/check-manifests"; import "node:fs";',
    }),
  ).toEqual([]);
});

test('a re-export fails, and a local export passes', async () => {
  expect(
    await lint({
      'reexports.ts': [
        'export { git } from "@repo/runtime/src/git";',
        'export { git as run } from "@repo/runtime/src/git";',
        'export * from "@repo/runtime/src/schema";',
        'export * as schema from "@repo/runtime/src/schema";',
        'export type { Outcome } from "@repo/runtime/src/session-queue";',
        'export * from "stripe";',
      ].join('\n'),
    }),
  ).toEqual(Array.from({ length: 6 }, () => 'reexports.ts no-reexports'));
  expect(
    await lint({
      'local.ts': [
        'import { git } from "@repo/runtime/src/git";',
        'export const value = 1;',
        'export function run() { return git; }',
        'const hidden = 2;',
        'export { hidden };',
        'export type Item = { id: string };',
      ].join('\n'),
    }),
  ).toEqual([]);
});

test('packages never import apps or tools, and client and contract files stay portable', async () => {
  const packages = {
    [registryFile]: registryYaml,
    'packages/access/package.json': tagged('service'),
    'packages/billing/package.json': tagged('service'),
    'packages/sync/package.json': tagged('service'),
    'packages/projects/package.json': tagged('domain'),
  };
  expect(
    await lint({
      ...packages,
      'packages/projects/src/server.ts':
        'import "@apps/api/worker"; import "@tools/lint/check-manifests"; import "@/lib/auth-platform";',
      'packages/projects/src/client.ts':
        'import "@repo/projects/src/server"; import "node:fs"; import "next";',
      'packages/billing/src/client/plans.ts': 'import "stripe";',
      'packages/sync/src/contracts.ts': 'import "@repo/sync/src/server";',
    }),
  ).toEqual([
    'packages/billing/src/client/plans.ts module-dependencies',
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
      'packages/billing/src/server.ts': 'import "stripe";',
      'packages/sync/src/contracts.ts': 'export type Scalar = string | number | boolean | null;',
      'apps/api/worker.ts':
        'import "@repo/projects/src/server"; import "@repo/projects/src/client";',
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

test('vendor and language rules do nothing until the registry names them', async () => {
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

test('drizzle-orm, one and react are imported only in their languages', async () => {
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
    'apps/api/worker.ts languages',
    'apps/app/lib/gate.tsx languages',
    'packages/identity/src/server.ts languages',
    'packages/projects/src/server/model.ts languages',
    'packages/projects/src/server/model.ts languages',
    'packages/projects/src/ui/workspace.tsx languages',
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
    'packages/projects/test/sync.test.ts languages',
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
    'packages/projects/src/server/legacy-billing.ts languages',
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
