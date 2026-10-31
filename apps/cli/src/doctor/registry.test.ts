import { expect, test } from 'bun:test';

import { docProblems, validateRegistry } from '@/doctor/registry';

const valid = {
  id: 'codeql_sast',
  name: 'CodeQL / SAST',
  category: 'Trust',
  phase: 'P1',
  level: 'core' as const,
  effort: 'S',
  research: { rank: 16, priority: 44.6, adoption_top: 0.67 },
  doc: 'docs/contributing/capabilities/codeql-sast.md',
  detect: [
    {
      any: [
        { workflow: { uses: 'github/codeql-action/' } },
        { remote: 'code_scanning_default_setup' },
      ],
    },
  ],
};

const problems = (capabilities: Array<unknown>) =>
  validateRegistry({ version: 1, capabilities }).errors.map((error) => [error.id, error.field]);

test('a valid registry gives its entries', () => {
  expect(validateRegistry({ version: 1, capabilities: [valid] })).toEqual({
    capabilities: [valid],
    errors: [],
  });
});

test('each bad entry field names the entry and the field', () => {
  expect(
    problems([
      { ...valid, category: 'Security', phase: 'P9', level: 'must', doc: 'docs/codeql.md' },
      { ...valid, id: 'Bad-Id' },
      valid,
    ]),
  ).toEqual([
    ['codeql_sast', 'category'],
    ['codeql_sast', 'phase'],
    ['codeql_sast', 'level'],
    ['codeql_sast', 'doc'],
    ['Bad-Id', 'id'],
    ['codeql_sast', 'id'],
  ]);
});

test('each bad rule names its path inside the entry', () => {
  expect(
    problems([
      {
        ...valid,
        detect: [
          { file: 'a', grep: { files: 'b', pattern: 'c' } },
          { file: 'a', min: 2, owner: 'x' },
          { workflow: { branch: 'main' } },
          { any: [] },
          { all: [{ yaml: { file: 'x' } }] },
        ],
        partial_if: 'file: x',
      },
    ]),
  ).toEqual([
    ['codeql_sast', 'detect[0]'],
    ['codeql_sast', 'detect[1].owner'],
    ['codeql_sast', 'detect[2].workflow'],
    ['codeql_sast', 'detect[3].any'],
    ['codeql_sast', 'detect[4].all[0].yaml'],
    ['codeql_sast', 'partial_if'],
  ]);
});

test('a file without version 1 and a capabilities list is one error', () => {
  expect(validateRegistry({ capabilities: [] }).errors).toEqual([
    { id: '', field: '', message: 'Expected version: 1 and a capabilities list.' },
  ]);
});

test('a capability without a page, and a page without a capability, are errors', () => {
  const entry = { ...valid, level: 'core' as const };
  expect(docProblems([entry], [valid.doc])).toEqual([]);
  expect(docProblems([entry], [])).toEqual([
    {
      id: 'codeql_sast',
      field: 'doc',
      message: 'docs/contributing/capabilities/codeql-sast.md does not exist. Write the page.',
    },
  ]);
  expect(docProblems([entry], [valid.doc, 'docs/contributing/capabilities/orphan.md'])).toEqual([
    {
      id: '',
      field: 'doc',
      message:
        'docs/contributing/capabilities/orphan.md has no capability in the registry. Add the entry, or delete the page.',
    },
  ]);
});
