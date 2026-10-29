import { expect, test } from 'bun:test';

import { lint } from '@tools/testing/lint-imports';

const cast = 'type Row = { readonly id: string };\nexport const row = JSON.parse("{}") as Row;\n';
const asConst = 'export const kinds = ["a", "b"] as const;\n';

test('product code may not assert a type, outside repo mappings and tests', async () => {
  expect(
    await lint(
      {
        'packages/sync/runtime/pool.ts': cast,
        'packages/notes/ui/use-notes.ts': cast,
        'features/notes/screens/notes-screen.tsx': cast,
        'apps/web/src/main.tsx': cast,
        'apps/api/src/server.ts': cast,
        'packages/notes/models/note.ts': asConst,
      },
      ['typescript'],
    ),
  ).toEqual([
    'apps/api/src/server.ts typescript/consistent-type-assertions',
    'apps/web/src/main.tsx typescript/consistent-type-assertions',
    'features/notes/screens/notes-screen.tsx typescript/consistent-type-assertions',
    'packages/notes/ui/use-notes.ts typescript/consistent-type-assertions',
    'packages/sync/runtime/pool.ts typescript/consistent-type-assertions',
  ]);
});

test('a repo mapping, a testing helper, a test and tooling may assert a type', async () => {
  expect(
    await lint(
      {
        'packages/notes/repo/note.ts': cast,
        'packages/notes/testing/notes.ts': cast,
        'packages/notes/commands/notes-commands.test.ts': cast,
        'tools/check-x.ts': cast,
      },
      ['typescript'],
    ),
  ).toEqual([]);
});
