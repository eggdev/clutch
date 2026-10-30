import { expect, test } from 'bun:test';

import { mockCall, notAnAlias, parseRegistry, registryFile } from '@tools/lint/import-policy.mjs';
import { fixtureRegistry, fixtureRegistryYaml, lint } from '@tools/testing/lint-imports';
import { stringify } from 'yaml';

test('vendor and language rules do nothing until the registry names them', async () => {
  expect(
    await lint({
      'packages/projects/service/plans.ts':
        'import "stripe"; import "drizzle-orm"; import "react";',
    }),
  ).toEqual([]);
});

test('a vendor is imported only in the config, repo, runtime or testing of its owner', async () => {
  expect(
    await lint({
      [registryFile]: fixtureRegistryYaml,
      'packages/projects/service/plans.ts':
        'import "better-auth"; import "@better-auth/core"; import "better-call"; import "stripe"; import "unpdf";',
      'apps/api/src/main.ts': 'import "@automerge/automerge"; import "better-auth/plugins";',
      'packages/billing/service/charge.ts': 'import "stripe";',
    }),
  ).toEqual([
    'apps/api/src/main.ts vendor-owner',
    'apps/api/src/main.ts vendor-owner',
    'packages/billing/service/charge.ts vendor-owner',
    'packages/projects/service/plans.ts vendor-owner',
    'packages/projects/service/plans.ts vendor-owner',
    'packages/projects/service/plans.ts vendor-owner',
    'packages/projects/service/plans.ts vendor-owner',
    'packages/projects/service/plans.ts vendor-owner',
  ]);
  expect(
    await lint({
      [registryFile]: fixtureRegistryYaml,
      'packages/identity/runtime/live.server.ts': 'import "better-auth"; import "better-call";',
      'packages/identity/testing/layer.ts': 'import "@better-auth/memory-adapter";',
      'packages/identity/test/live.test.ts': 'import "better-auth";',
      'packages/sync/repo/log.ts': 'import "@automerge/automerge";',
      'packages/billing/config/stripe.ts': 'import "stripe";',
      'packages/document-extraction/repo/pdf.ts': 'import "unpdf";',
    }),
  ).toEqual([]);
});

test('drizzle-orm, one and react are imported only in their languages', async () => {
  expect(
    await lint({
      [registryFile]: fixtureRegistryYaml,
      'packages/projects/service/model.ts': 'import "drizzle-orm"; import "react";',
      'apps/api/src/main.ts': 'import "drizzle-orm/d1";',
      'apps/app/lib/gate.tsx': 'import "one";',
      'packages/projects/ui/workspace.tsx': 'import "one";',
      'packages/identity/service/actor.ts': 'import "react-native";',
    }),
  ).toEqual([
    'apps/api/src/main.ts languages',
    'apps/app/lib/gate.tsx languages',
    'packages/identity/service/actor.ts languages',
    'packages/projects/service/model.ts languages',
    'packages/projects/service/model.ts languages',
    'packages/projects/ui/workspace.tsx languages',
  ]);
  expect(
    await lint({
      [registryFile]: fixtureRegistryYaml,
      'packages/projects/repo/schema.ts': 'import "drizzle-orm/sqlite-core";',
      'packages/storage/service/d1.ts': 'import "drizzle-orm/d1";',
      'apps/app/app/_layout.tsx': 'import "one"; import "react";',
      'apps/app/vite.config.ts': 'import "one/vite";',
      'apps/app/react-native.config.cjs': 'require("one/react-native-commands");',
      'apps/app/lib/gate.tsx': 'import "react"; import "react-native";',
      'packages/projects/ui/workspace.tsx': 'import "react"; import "react-native";',
      'packages/design-system/ui/button.tsx': 'import "react-native";',
      'features/notes/screens/list.tsx': 'import "react";',
    }),
  ).toEqual([]);
});

test('testing/ is imported only by test files and other testing/ files', async () => {
  expect(
    await lint({
      'packages/projects/service/plans.ts': 'import "@repo/sync/testing/fake-transport";',
      'apps/api/src/main.ts': 'import "@repo/projects/testing/project";',
    }),
  ).toEqual([
    'apps/api/src/main.ts testing-imports',
    'packages/projects/service/plans.ts testing-imports',
  ]);
  expect(
    await lint({
      'packages/projects/test/sync.test.ts': 'import "@repo/sync/testing/fake-transport";',
      'packages/projects/testing/project.ts': 'import "@repo/sync/testing/fake-transport";',
      'apps/api/browser/onboarding.pw.ts': 'import "@repo/projects/testing/project";',
    }),
  ).toEqual([]);
});

test('every rule reads vi.mock, jest.mock and mock.module specifiers like imports', async () => {
  expect(
    await lint({
      [registryFile]: fixtureRegistryYaml,
      'packages/projects/test/sync.test.ts': [
        'vi.mock("./relative");',
        'vi.mock("stripe");',
        'jest.requireActual("../parent");',
        'mock.module("drizzle-orm", () => ({}));',
        'vi.mock("@repo/sync/service/sync");',
        'vi.importActual("@repo/sync/service/sync");',
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
    [
      './x',
      '../x',
      '@repo/sync',
      '/abs',
      '@repo/sync/service/sync',
      'stripe',
      '@apps/api/x',
      '@features/notes',
    ].filter(notAnAlias),
  ).toEqual(['./x', '../x', '@repo/sync', '/abs', '@apps/api/x', '@features/notes']);
});

test('an exception lets one file import one specifier past one rule, and needs a reason', async () => {
  const exception = {
    rule: 'vendor-owner',
    file: '/packages/projects/repo/legacy-billing\\.ts$',
    imports: '^stripe$',
    reason: 'The legacy webhook verifies its signature before billing exposes a service for it.',
  };
  const withException = stringify({ ...fixtureRegistry, exceptions: [exception] });
  expect(
    await lint({
      [registryFile]: withException,
      'packages/projects/repo/legacy-billing.ts': 'import "stripe"; import "react";',
      'packages/projects/repo/invoices.ts': 'import "stripe";',
    }),
  ).toEqual([
    'packages/projects/repo/invoices.ts vendor-owner',
    'packages/projects/repo/legacy-billing.ts languages',
  ]);
  expect(() => parseRegistry({ exceptions: [{ ...exception, reason: ' ' }] })).toThrow(
    'docs/contributing/architecture/primitives.yaml exceptions[0]: `reason` must say why the import cannot move behind a boundary.',
  );
  expect(() => parseRegistry({ exceptions: [{ ...exception, rule: 'vendor' }] })).toThrow(
    '`rule` must be one of aliases-only',
  );
});
