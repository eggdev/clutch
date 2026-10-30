import { expect, test } from 'bun:test';

import { issueText, nextId, parseRange } from '@/issues/new';
import { parseIssue } from '@/issues/parse';

test('the next id is one above the highest taken in the range, never a gap', () => {
  expect(nextId(new Set([101, 103, 250]), { low: 100, high: 199 })).toBe('CL-104');
  expect(nextId(new Set(), { low: 118, high: 120 })).toBe('CL-118');
  expect(nextId(new Set([7]), { low: 1, high: 99 })).toBe('CL-008');
});

test('a full range is an error that names it', () => {
  expect(() => nextId(new Set([120]), { low: 118, high: 120 })).toThrow(
    'No free id in CL-118..CL-120.',
  );
});

test('a range reads CL-NNN..CL-NNN, low to high', () => {
  expect(parseRange('CL-118..CL-120')).toEqual({ low: 118, high: 120 });
  expect(() => parseRange('CL-120..CL-118')).toThrow('--range takes CL-NNN..CL-NNN');
  expect(() => parseRange('118-120')).toThrow('--range takes CL-NNN..CL-NNN');
});

test('the written file parses as a todo issue with every field', () => {
  const text = issueText({
    id: 'CL-118',
    title: "Allocate the owner's ids",
    phase: 'P1',
    dependsOn: ['CL-003', 'CL-104'],
    owner: 'agent',
  });
  expect(parseIssue('.clutch/issues/CL-118.md', text)).toEqual({
    issue: {
      id: 'CL-118',
      title: "Allocate the owner's ids",
      phase: 'P1',
      status: 'todo',
      dependsOn: ['CL-003', 'CL-104'],
      pr: '',
      owner: 'agent',
      file: '.clutch/issues/CL-118.md',
    },
    errors: [],
  });
  expect(text).toContain("# CL-118: Allocate the owner's ids\n\n## Goal\n");
});
