import { expect, test } from 'bun:test';

import { lint, serverApp } from '@tools/testing/lint-imports';

test('Oxlint rejects relative, @apps/ and bare package imports', async () => {
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
        'import "@apps/api/worker";',
        'import "@features/notes";',
      ].join('\n'),
    }),
  ).toEqual([
    ...Array.from({ length: 12 }, () => 'bad.ts aliases-only'),
    'bad.ts no-reexports',
    'bad.ts no-reexports',
  ]);
  expect(
    await lint({
      'clean.ts':
        'import "@/lib/auth-context"; import "@repo/sync/runtime/boot"; import "@tools/lint/check-manifests"; import "node:fs"; import "@features/notes/gate";',
    }),
  ).toEqual([]);
});

test('a re-export fails, and a local export passes', async () => {
  expect(
    await lint({
      'reexports.ts': [
        'export { git } from "@repo/runtime/service/git";',
        'export { git as run } from "@repo/runtime/service/git";',
        'export * from "@repo/runtime/repo/schema";',
        'export * as schema from "@repo/runtime/repo/schema";',
        'export type { Outcome } from "@repo/runtime/types/contracts";',
        'export * from "stripe";',
      ].join('\n'),
    }),
  ).toEqual(Array.from({ length: 6 }, () => 'reexports.ts no-reexports'));
  expect(
    await lint({
      'local.ts': [
        'import { git } from "@repo/runtime/service/git";',
        'export const value = 1;',
        'export function run() { return git; }',
        'const hidden = 2;',
        'export { hidden };',
        'export type Item = { id: string };',
      ].join('\n'),
    }),
  ).toEqual([]);
});

test('imports go from apps to features to packages, and never back', async () => {
  expect(
    await lint({
      'packages/projects/service/plans.ts':
        'import "@features/notes/gate"; import "@tools/lint/check-manifests"; import "@/lib/auth";',
      'features/notes/gate.ts': 'import "@tools/testing/in-repo"; import "@/routes";',
    }),
  ).toEqual([
    'features/notes/gate.ts tier-direction',
    'features/notes/gate.ts tier-direction',
    'packages/projects/service/plans.ts tier-direction',
    'packages/projects/service/plans.ts tier-direction',
    'packages/projects/service/plans.ts tier-direction',
  ]);
  expect(
    await lint({
      'features/notes/gate.ts':
        'import "@repo/notes/models/note"; import "@features/notes/screens/list";',
      'apps/web/src/main.tsx':
        'import "@features/notes/gate"; import "@repo/sync/runtime/boot"; import "@/routes";',
      'packages/notes/ui/title.tsx': 'import "@repo/design-system/ui/button";',
    }),
  ).toEqual([]);
});

test('a feature never imports another feature, and private sections stay in their package', async () => {
  expect(
    await lint({
      'features/notes/screens/list.tsx': 'import "@features/billing/gate";',
      'features/notes/gate.ts': 'import "@repo/notes/runtime/handlers.server";',
      'packages/billing/service/charge.ts':
        'import "@repo/notes/repo/schema"; import "@repo/notes/config/keys"; import "@repo/notes/src/server";',
      'packages/notes/ui/list.tsx': 'import "@repo/notes/lib/util";',
    }),
  ).toEqual([
    'features/notes/gate.ts section-access',
    'features/notes/gate.ts server-only',
    'features/notes/screens/list.tsx feature-isolation',
    'packages/billing/service/charge.ts section-access',
    'packages/billing/service/charge.ts section-access',
    'packages/billing/service/charge.ts section-access',
    'packages/notes/ui/list.tsx section-access',
  ]);
  expect(
    await lint({
      'packages/notes/service/notes.ts':
        'import "@repo/notes/repo/schema"; import "@repo/notes/config/keys"; import "@repo/identity/service/actor";',
      'apps/api/package.json': serverApp,
      'apps/api/src/main.ts': 'import "@repo/notes/runtime/handlers.server";',
      'packages/notes/runtime/handlers.server.ts': 'import "@repo/notes/commands/rename.server";',
      'packages/billing/test/charge.test.ts': 'import "@repo/notes/runtime/live.server";',
    }),
  ).toEqual([]);
});

test('client code never imports server code, and server code may', async () => {
  expect(
    await lint({
      'packages/notes/ui/title.tsx':
        'import "@repo/notes/service/notes"; import "@repo/notes/commands/rename.server";',
      'packages/notes/commands/rename.ts': 'import "@repo/notes/repo/schema";',
      'apps/web/src/main.tsx': 'import "@repo/notes/service/notes";',
      'packages/notes/runtime/boot.ts': 'import "@repo/notes/service/notes";',
    }),
  ).toEqual([
    'apps/web/src/main.tsx server-only',
    'packages/notes/commands/rename.ts server-only',
    'packages/notes/runtime/boot.ts server-only',
    'packages/notes/ui/title.tsx server-only',
    'packages/notes/ui/title.tsx server-only',
  ]);
  expect(
    await lint({
      'packages/notes/commands/rename.server.ts':
        'import "@repo/notes/repo/schema"; import "@repo/notes/service/notes";',
      'packages/notes/service/notes.ts': 'import "@repo/notes/repo/schema";',
      'packages/notes/runtime/handlers.server.ts':
        'import "@repo/notes/commands/rename.server"; import "@repo/notes/service/notes";',
      'apps/api/package.json': serverApp,
      'apps/api/src/main.ts': 'import "@repo/notes/service/notes";',
      'packages/notes/ui/title.tsx':
        'import "@repo/notes/commands/rename"; import "@repo/notes/models/note";',
    }),
  ).toEqual([]);
});

test('an import that closes a package cycle fails at each end, and passes once the cycle is gone', async () => {
  expect(
    await lint({
      'packages/access/service/access.ts': 'import "@repo/sync/service/sync";',
      'packages/sync/service/sync.ts': 'import "@repo/storage/service/connection";',
      'packages/storage/test/connection.test.ts': 'import "@repo/access/service/access";',
    }),
  ).toEqual([
    'packages/access/service/access.ts no-cycles',
    'packages/storage/test/connection.test.ts no-cycles',
    'packages/sync/service/sync.ts no-cycles',
  ]);
  expect(
    await lint({
      'packages/access/service/access.ts': 'import "@repo/sync/service/sync";',
      'packages/sync/service/sync.ts': 'import "@repo/storage/service/connection";',
      'packages/storage/test/connection.test.ts': 'import "@repo/storage/service/connection";',
    }),
  ).toEqual([]);
});
