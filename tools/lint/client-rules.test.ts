import { expect, test } from 'bun:test';

import { lint } from '@tools/testing/lint-imports';

const plugins = ['eslint', 'repo-effect'];

test('a screen that loads its data in an effect fails twice: the effect and the request', async () => {
  expect(
    await lint(
      {
        'features/notes/screens/notes-screen.tsx': [
          "import { useEffect, useState } from 'react';",
          'export function NotesScreen() {',
          '  const [notes, setNotes] = useState([]);',
          "  useEffect(() => { fetch('/api/notes').then((r) => r.json()).then(setNotes); }, []);",
          '  return notes.length;',
          '}',
        ].join('\n'),
      },
      plugins,
    ),
  ).toEqual([
    'features/notes/screens/notes-screen.tsx eslint/no-restricted-globals',
    'features/notes/screens/notes-screen.tsx eslint/no-restricted-imports',
  ]);
});

test('each way around the effect ban fails', async () => {
  expect(
    await lint(
      {
        'features/notes/components/a.tsx':
          "import { useLayoutEffect } from 'react'; export const x = useLayoutEffect;",
        'features/notes/components/b.tsx':
          "import { useEffect as onMount } from 'react'; export const x = onMount;",
        'features/notes/components/c.tsx':
          "import * as React from 'react'; export const x = React.useEffect;",
        'features/notes/components/d.tsx':
          "import React from 'react'; export const x = React.useInsertionEffect;",
        'packages/notes/service/notes.ts':
          "import { useEffect } from 'react'; export const x = useEffect;",
      },
      plugins,
    ),
  ).toEqual([
    'features/notes/components/a.tsx eslint/no-restricted-imports',
    'features/notes/components/b.tsx eslint/no-restricted-imports',
    'features/notes/components/c.tsx eslint/no-restricted-imports',
    'features/notes/components/c.tsx repo-effect/no-react-effects',
    'features/notes/components/d.tsx repo-effect/no-react-effects',
    'packages/notes/service/notes.ts eslint/no-restricted-imports',
  ]);
  expect(
    await lint(
      {
        'packages/sync/ui/sync-provider.tsx':
          "import { useEffect, useSyncExternalStore } from 'react'; export const x = [useEffect, useSyncExternalStore];",
        'features/notes/screens/list.tsx':
          "import { useState } from 'react'; export const x = useState;",
      },
      plugins,
    ),
  ).toEqual([]);
});

test('client code never uses the network or device storage, and the sync engine may', async () => {
  expect(
    await lint(
      {
        'apps/web/src/save.ts': "window.localStorage.setItem('draft', '1');",
        'features/notes/gate.ts': "export const socket = new WebSocket('wss://x');",
        'packages/notes/models/note.ts': "export const ping = () => navigator.sendBeacon('/a');",
        'packages/notes/commands/rename-note.ts': 'export const db = indexedDB;',
        'packages/notes/ui/use-notes.ts': "export const load = () => globalThis.fetch('/a');",
      },
      plugins,
    ),
  ).toEqual([
    'apps/web/src/save.ts eslint/no-restricted-properties',
    'features/notes/gate.ts eslint/no-restricted-globals',
    'packages/notes/commands/rename-note.ts eslint/no-restricted-globals',
    'packages/notes/models/note.ts eslint/no-restricted-properties',
    'packages/notes/ui/use-notes.ts eslint/no-restricted-properties',
  ]);
  expect(
    await lint(
      {
        'packages/sync/runtime/local-database.ts': 'export const db = indexedDB;',
        'packages/sync/ui/online.ts': "export const ping = () => fetch('/health');",
        'packages/notes/commands/rename-note.server.ts': "export const ping = () => fetch('/a');",
        'apps/api/src/main.ts': "export const ping = () => fetch('/a');",
      },
      plugins,
    ),
  ).toEqual([]);
});

test('client code imports Effect and schemas as types only', async () => {
  expect(
    await lint(
      {
        'features/notes/components/note-row.tsx':
          "import { Note } from '@repo/notes/types/note'; export const x = Note;",
        'packages/notes/ui/use-notes.ts':
          "import { Schema } from 'effect'; export const x = Schema;",
        'packages/notes/models/note.ts':
          "import { RpcClient } from 'effect/rpc'; export const x = RpcClient;",
      },
      plugins,
    ),
  ).toEqual([
    'features/notes/components/note-row.tsx eslint/no-restricted-imports',
    'packages/notes/models/note.ts eslint/no-restricted-imports',
    'packages/notes/ui/use-notes.ts eslint/no-restricted-imports',
  ]);
  expect(
    await lint(
      {
        'features/notes/components/note-row.tsx':
          "import type { Note } from '@repo/notes/types/note'; import { type Effect } from 'effect'; export type X = [Note, Effect.Effect<1>];",
        'packages/notes/types/note.ts': "import { Schema } from 'effect'; export const x = Schema;",
        'packages/notes/screens.test.tsx':
          "import { Effect } from 'effect'; export const x = Effect;",
      },
      plugins,
    ),
  ).toEqual([]);
});

test('only an edge runs an Effect, and server code fails with tagged errors', async () => {
  expect(
    await lint(
      {
        'packages/notes/service/notes.ts': [
          "import { Effect } from 'effect';",
          'export async function rename(id: string) {',
          "  if (!id) { throw new Error('missing'); }",
          '  return Effect.runPromise(Effect.succeed(id));',
          '}',
          'export const wait = () => new Promise((resolve) => setTimeout(resolve, 1));',
        ].join('\n'),
        'packages/notes/commands/rename-note.server.ts':
          'export const run = async () => { throw new Error("x"); };',
        'features/notes/gate.ts':
          "import type { Effect } from 'effect'; declare const E: typeof Effect; export const x = E.runSync;",
      },
      ['repo-effect'],
    ),
  ).toEqual([
    'packages/notes/commands/rename-note.server.ts repo-effect/tagged-errors',
    'packages/notes/commands/rename-note.server.ts repo-effect/tagged-errors',
    'packages/notes/service/notes.ts repo-effect/run-at-edges',
    'packages/notes/service/notes.ts repo-effect/tagged-errors',
    'packages/notes/service/notes.ts repo-effect/tagged-errors',
    'packages/notes/service/notes.ts repo-effect/tagged-errors',
  ]);
  expect(
    await lint(
      {
        'packages/sync/runtime/transport.ts':
          "import { Effect } from 'effect'; export const go = () => Effect.runFork(Effect.void);",
        'apps/api/src/main.ts':
          "import { Effect } from 'effect'; export const go = () => Effect.runPromise(Effect.void);",
        'packages/notes/service/notes.test.ts':
          "import { Effect } from 'effect'; export const go = async () => { await Effect.runPromise(Effect.void); throw new Error('x'); };",
        'packages/runtime/package.json': JSON.stringify({ nx: { tags: ['type:tool'] } }),
        'packages/runtime/service/session-queue.ts':
          'export async function next() { throw new Error("x"); }',
      },
      ['repo-effect'],
    ),
  ).toEqual([]);
});
