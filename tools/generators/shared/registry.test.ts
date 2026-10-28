import { expect, test } from 'bun:test';

import { addGateEntry } from '@tools/generators/shared/gates.ts';
import { addImport, addToArray } from '@tools/generators/shared/registry.ts';

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

test('an import goes after the last import, once', () => {
  const source = "import { a } from 'a';\n\nexport const b = [a];\n";
  const added = addImport(source, "import { c } from 'c';");
  expect(added).toBe("import { a } from 'a';\nimport { c } from 'c';\n\nexport const b = [a];\n");
  expect(addImport(added, "import { c } from 'c';")).toBe(added);
  expect(addImport('export const b = [];\n', "import { c } from 'c';")).toBe(
    "import { c } from 'c';\n\nexport const b = [];\n",
  );
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
