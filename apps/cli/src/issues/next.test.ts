import { expect, test } from 'bun:test';

import { nextIssue } from '@/issues/next';
import type { Issue } from '@/issues/parse';

const issue = (id: string, fields: Partial<Issue> = {}): Issue => ({
  id,
  title: id,
  phase: 'P0',
  status: 'todo',
  dependsOn: [],
  pr: '',
  owner: 'agent',
  file: `.clutch/issues/${id}.md`,
  ...fields,
});

test('the next issue is the first todo agent issue whose dependencies are done', () => {
  const issues = [
    issue('CL-001', { status: 'done' }),
    issue('CL-002', { status: 'review', dependsOn: ['CL-001'] }),
    issue('CL-003', { dependsOn: ['CL-002'] }),
    issue('CL-004', { owner: 'brendan', dependsOn: ['CL-001'] }),
    issue('CL-005', { dependsOn: ['CL-001'] }),
  ];
  expect(nextIssue(issues)?.id).toBe('CL-005');
});

test('phase order wins over id order, and a later issue never comes next', () => {
  const issues = [
    issue('CL-101', { phase: 'P1' }),
    issue('CL-601', { phase: 'RN' }),
    issue('CL-020', { phase: 'P0' }),
    issue('CL-901', { phase: 'later' }),
  ];
  expect(nextIssue(issues)?.id).toBe('CL-020');
  expect(nextIssue([issue('CL-901', { phase: 'later' })])).toBeUndefined();
});

test('with stack, a dependency in review counts until the stack is 3 PRs deep', () => {
  const chain = [
    issue('CL-001', { status: 'review' }),
    issue('CL-002', { status: 'review', dependsOn: ['CL-001'] }),
    issue('CL-003', { dependsOn: ['CL-002'] }),
  ];
  expect(nextIssue(chain)).toBeUndefined();
  expect(nextIssue(chain, { stack: true })?.id).toBe('CL-003');

  const deep = [
    ...chain.slice(0, 2),
    issue('CL-003', { status: 'review', dependsOn: ['CL-002'] }),
    issue('CL-004', { dependsOn: ['CL-003'] }),
  ];
  expect(nextIssue(deep, { stack: true })).toBeUndefined();
});

test('a dependency that is blocked or in progress holds the issue back, even with stack', () => {
  const issues = [
    issue('CL-001', { status: 'in_progress' }),
    issue('CL-002', { dependsOn: ['CL-001'] }),
  ];
  expect(nextIssue(issues, { stack: true })).toBeUndefined();
});
