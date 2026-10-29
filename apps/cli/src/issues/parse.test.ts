import { expect, test } from 'bun:test';

import { checkGraph, parseIssue, readIssues } from '@/issues/parse';
import type { Issue } from '@/issues/parse';
import { gitRepo } from '@/testing/git-repo';

const text = (fields: Record<string, string>) =>
  `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')}\n---\n\n# Body\n`;

const valid = {
  id: 'CL-003',
  title: "'Add the issues command'",
  phase: 'P0',
  status: 'todo',
  depends_on: '[CL-002]',
  pr: "''",
  owner: 'agent',
};

test('a valid issue file gives a typed issue', () => {
  expect(parseIssue('.clutch/issues/CL-003.md', text(valid))).toEqual({
    issue: {
      id: 'CL-003',
      title: 'Add the issues command',
      phase: 'P0',
      status: 'todo',
      dependsOn: ['CL-002'],
      pr: '',
      owner: 'agent',
      file: '.clutch/issues/CL-003.md',
    },
    errors: [],
  });
});

test('each bad value names the file and the field', () => {
  const file = '.clutch/issues/CL-003.md';
  const { issue, errors } = parseIssue(
    file,
    text({ ...valid, status: 'started', pr: 'not a url', extra: 'x' }),
  );
  expect(issue).toBeUndefined();
  expect(errors.map((error) => [error.file, error.field])).toEqual([
    [file, 'extra'],
    [file, 'status'],
    [file, 'pr'],
  ]);
});

test('a missing field, a missing frontmatter and a wrong file name are errors', () => {
  const { depends_on: _, ...noDeps } = valid;
  expect(parseIssue('.clutch/issues/CL-003.md', text(noDeps)).errors).toEqual([
    { file: '.clutch/issues/CL-003.md', field: 'depends_on', message: 'Missing field.' },
  ]);
  expect(parseIssue('.clutch/issues/CL-003.md', '# No frontmatter\n').errors).toHaveLength(1);
  expect(parseIssue('.clutch/issues/CL-004.md', text(valid)).errors).toEqual([
    { file: '.clutch/issues/CL-004.md', field: 'id', message: 'The file name must be CL-003.md.' },
  ]);
});

const issue = (id: string, dependsOn: Array<string>): Issue => ({
  id,
  title: id,
  phase: 'P0',
  status: 'todo',
  dependsOn,
  pr: '',
  owner: 'agent',
  file: `.clutch/issues/${id}.md`,
});

test('an unknown dependency and a cycle are errors', () => {
  const errors = checkGraph([
    issue('CL-001', ['CL-003']),
    issue('CL-002', ['CL-001']),
    issue('CL-003', ['CL-002', 'CL-009']),
  ]);
  expect(errors.map((error) => error.message)).toEqual([
    'Unknown issue CL-009.',
    'Dependency cycle: CL-001 -> CL-003 -> CL-002 -> CL-001.',
  ]);
});

test('readIssues reads every file in id order and reports a reused id', async () => {
  await using repo = await gitRepo({
    '.clutch/issues/CL-002.md': text({ ...valid, id: 'CL-002', depends_on: '[CL-001]' }),
    '.clutch/issues/CL-001.md': text({ ...valid, id: 'CL-001', depends_on: '[]' }),
    '.clutch/issues/notes.txt': 'ignored',
  });
  const { issues, errors } = await readIssues(repo.root);
  expect(issues.map((item) => item.id)).toEqual(['CL-001', 'CL-002']);
  expect(errors).toEqual([]);
});
