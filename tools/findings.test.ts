import { expect, test } from 'bun:test';

import { clearFindings, formatFinding, readFindings, writeFindings } from '@tools/findings';
import { inRepo } from '@tools/testing/in-repo';

const finding = {
  id: 'check-x/too-long',
  file: 'docs/a.md',
  problem: 'the line is too long.',
  fix: 'Split it.',
};

test('the text form names the file, the problem and the fix', () => {
  expect(formatFinding(finding)).toBe('docs/a.md: the line is too long. Split it.');
  expect(formatFinding({ ...finding, line: 12 })).toBe(
    'docs/a.md:12: the line is too long. Split it.',
  );
});

test('a problem that already says the fix prints alone, and a long problem puts the fix on its own line', () => {
  expect(formatFinding({ ...finding, fix: '' })).toBe('docs/a.md: the line is too long.');
  expect(formatFinding({ ...finding, problem: 'two lines are too long.\n  12\n  14' })).toBe(
    'docs/a.md: two lines are too long.\n  12\n  14\n  Split it.',
  );
});

test('each check writes its findings to a file, and a collection reads them by check name', async () => {
  const read = await inRepo({}, (root) => {
    writeFindings(root, 'check-y', []);
    writeFindings(root, 'check-x', [finding]);
    const both = readFindings(root);
    clearFindings(root);
    return { both, after: readFindings(root) };
  });
  expect(read.both).toEqual({ 'check-x': [finding], 'check-y': [] });
  expect(Object.keys(read.both)).toEqual(['check-x', 'check-y']);
  expect(read.after).toEqual({});
});
