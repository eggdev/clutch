import { expect, test } from 'bun:test';

import { addGateEntry } from '@tools/generators/shared/gates.ts';
import {
  addImport,
  addToArray,
  declaresConstant,
  insertBeforeContract,
  mergeNamedImport,
} from '@tools/generators/shared/registry.ts';

test('an element goes at the end of the named array, once, and an empty array takes it', () => {
  const source = '/** Lists. */\nexport const commands = [...notesCommands];\nconst other = [1];\n';
  const once = addToArray(source, { variable: 'commands' }, '...billingCommands');
  expect(once).toBe(
    '/** Lists. */\nexport const commands = [...notesCommands, ...billingCommands];\nconst other = [1];\n',
  );
  expect(addToArray(once, { variable: 'commands' }, '...billingCommands')).toBe(once);
  expect(addToArray('export const list = [];\n', { variable: 'list' }, 'first')).toBe(
    'export const list = [first];\n',
  );
  expect(() => addToArray(source, { variable: 'missing' }, 'x')).toThrow(
    'No array literal for `const missing`.',
  );
});

test('a call target finds the array argument, such as addChildren', () => {
  expect(
    addToArray(
      'const tree = root.addChildren([homeRoute, notesRoute]);\n',
      { call: 'addChildren' },
      'billingRoute',
    ),
  ).toBe('const tree = root.addChildren([homeRoute, notesRoute, billingRoute]);\n');
});

test('a property target finds the array of an object property, such as records', () => {
  const source =
    "export const notesContract = defineContract('notes', {\n  records: [noteRecord],\n  commands: [],\n});\n";
  const added = addToArray(source, { property: 'records' }, 'spaceNoteCountRecord');
  expect(added).toBe(
    "export const notesContract = defineContract('notes', {\n  records: [noteRecord, spaceNoteCountRecord],\n  commands: [],\n});\n",
  );
  expect(addToArray(added, { property: 'records' }, 'spaceNoteCountRecord')).toBe(added);
  expect(addToArray(source, { property: 'commands' }, 'createNote')).toBe(
    "export const notesContract = defineContract('notes', {\n  records: [noteRecord],\n  commands: [createNote],\n});\n",
  );
  expect(() => addToArray(source, { property: 'loads' }, 'x')).toThrow(
    'No array literal for `loads: [...]`.',
  );
});

test('a callee target finds the last array argument of a plain call, such as clientPackage', () => {
  const source =
    'export const notesCommands = clientPackage(notesContract, [createNoteLocal]);\nexport const other = wrap([1]);\n';
  expect(addToArray(source, { callee: 'clientPackage' }, 'renameNoteLocal')).toBe(
    'export const notesCommands = clientPackage(notesContract, [createNoteLocal, renameNoteLocal]);\nexport const other = wrap([1]);\n',
  );
  expect(
    addToArray(
      'export const accessCommands = clientPackage(accessContract, []);\n',
      { callee: 'clientPackage' },
      'joinSpaceLocal',
    ),
  ).toBe('export const accessCommands = clientPackage(accessContract, [joinSpaceLocal]);\n');
  expect(() =>
    addToArray('export const x = serverPackage(other);\n', { callee: 'serverPackage' }, 'y'),
  ).toThrow('No array literal for `serverPackage(..., [...])`.');
});

test('an import goes after the last import, once', () => {
  const source = "import { a } from 'a';\n\nexport const b = [a];\n";
  const added = addImport(source, "import { c } from 'c';");
  expect(added).toBe("import { a } from 'a';\nimport { c } from 'c';\n\nexport const b = [a];\n");
  expect(addImport(added, "import { c } from 'c';")).toBe(added);
  expect(addImport('export const b = [];\n', "import { c } from 'c';")).toBe(
    "import { c } from 'c';\n\nexport const b = [];\n",
  );
});

test('named imports from one module merge into one line, and a type import stays apart', () => {
  const source =
    "import { load, record } from '@repo/sync/contract/record';\n\nexport const a = 1;\n";
  expect(mergeNamedImport(source, '@repo/sync/contract/record', ['record'], false)).toBe(source);
  expect(mergeNamedImport(source, '@repo/sync/contract/record', ['text'], false)).toBe(
    "import { load, record, text } from '@repo/sync/contract/record';\n\nexport const a = 1;\n",
  );
  expect(mergeNamedImport(source, '@repo/sync/contract/record', ['RowOf'], true)).toBe(
    "import { load, record } from '@repo/sync/contract/record';\nimport type { RowOf } from '@repo/sync/contract/record';\n\nexport const a = 1;\n",
  );
  expect(
    mergeNamedImport(
      'export const a = 1;\n',
      '@repo/sync/contract/engine-groups',
      ['userGroup'],
      false,
    ),
  ).toBe("import { userGroup } from '@repo/sync/contract/engine-groups';\n\nexport const a = 1;\n");
});

test('a contract declaration gets new text above its JSDoc, and a file without one fails with the fix', () => {
  const source = [
    "import { defineContract } from '@repo/sync/contract/define';",
    '',
    '/** The contract of notes. */',
    "export const notesContract = defineContract('notes', {",
    '  records: [],',
    '  commands: [],',
    '  loads: [],',
    '});',
    '',
  ].join('\n');
  expect(insertBeforeContract(source, 'export const noteRecord = record();')).toBe(
    [
      "import { defineContract } from '@repo/sync/contract/define';",
      '',
      'export const noteRecord = record();',
      '',
      '/** The contract of notes. */',
      "export const notesContract = defineContract('notes', {",
      '  records: [],',
      '  commands: [],',
      '  loads: [],',
      '});',
      '',
    ].join('\n'),
  );
  expect(() => insertBeforeContract('export const x = 1;\n', 'y')).toThrow(
    'Declare the contract with `defineContract` first',
  );
  expect(declaresConstant(source, 'notesContract')).toBe(true);
  expect(declaresConstant(source, 'noteRecord')).toBe(false);
});

test('a gate goes into the gates object once', () => {
  const source = "rules: { 'repo-gates/one-gate': ['error', { gates: {} }] },\n";
  const added = addGateEntry(
    source,
    '/billing',
    'features/billing/gate.ts',
    'apps/web/src/routes/billing',
  );
  expect(added).toBe(
    "rules: { 'repo-gates/one-gate': ['error', { gates: {'/billing': { gate: 'features/billing/gate.ts', routes: 'apps/web/src/routes/billing' }} }] },\n",
  );
  expect(addGateEntry(added, '/billing', 'x', 'y')).toBe(added);
  expect(() => addGateEntry('const x = 1;\n', '/a', 'b', 'c')).toThrow('has no `gates` object');
});
