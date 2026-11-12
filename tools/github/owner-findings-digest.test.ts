import { expect, test } from 'bun:test';

import {
  findingsOf,
  maxRows,
  readOwnerFindings,
  renderSection,
} from '@tools/github/owner-findings-digest';
import type { Comment, Merged, Pull, Review } from '@tools/github/owner-findings-digest';
import type { Run } from '@tools/github/stack';

const bot = 'github-actions[bot]';
const repo = 'acme/tools';

const pull = (number: number, mergedAt: string, title = `PR ${number}`): Pull => ({
  number,
  title,
  url: `https://github.com/${repo}/pull/${number}`,
  headRefOid: 'head1',
  mergedAt,
});

const comment = (overrides: Partial<Comment>): Comment => ({
  review: 1,
  login: bot,
  path: 'tools/a.ts',
  line: 12,
  body: 'owner, weaker check (review.md, Owner findings 2). The budget rises.',
  url: `https://github.com/${repo}/pull/1#discussion_r1`,
  ...overrides,
});

const reviews: Array<Review> = [
  { id: 1, login: bot, commit: 'head1' },
  { id: 2, login: bot, commit: 'old' },
  { id: 3, login: 'alice', commit: 'head1' },
];

test('findingsOf keeps only a bot comment on the head whose first line opens an owner finding', () => {
  const comments: Array<Comment> = [
    comment({}),
    comment({ path: 'tools/b.ts', body: 'note: style only' }),
    comment({ path: 'tools/c.ts', body: '**blocking: a bug**' }),
    comment({ path: 'tools/d.ts', login: 'alice', review: 3 }),
    comment({ path: 'tools/e.ts', review: 2 }),
    comment({ path: 'tools/f.ts', review: null }),
  ];
  expect(findingsOf(pull(1, '2026-11-10T09:00:00Z'), reviews, comments)).toEqual([
    {
      path: 'tools/a.ts',
      line: 12,
      text: 'owner, weaker check (review.md, Owner findings 2). The budget rises.',
      url: `https://github.com/${repo}/pull/1#discussion_r1`,
    },
  ]);
});

test('findingsOf counts the same path, line and first line once', () => {
  const comments: Array<Comment> = [
    comment({}),
    comment({
      body: 'owner, weaker check (review.md, Owner findings 2). The budget rises.\n\nMore detail.',
    }),
    comment({ line: 13 }),
  ];
  expect(findingsOf(pull(1, '2026-11-10T09:00:00Z'), reviews, comments)).toHaveLength(2);
});

test('the section lists two pull requests newest first, with escaped pipes, a cut text and a null line', () => {
  const long = 'x'.repeat(250);
  const merged: Array<Merged> = [
    {
      pull: pull(254, '2026-11-10T09:00:00Z', 'feat: older'),
      findings: [
        {
          path: 'tools/z.ts',
          line: 3,
          text: `owner: ${long}`,
          url: `https://github.com/${repo}/pull/254#discussion_r9`,
        },
      ],
    },
    {
      pull: pull(255, '2026-11-11T09:00:00Z', 'fix: a | b'),
      findings: [
        {
          path: 'tools/x.ts',
          line: 12,
          text: 'owner, weaker check (review.md, Owner findings 2). The budget rises.',
          url: `https://github.com/${repo}/pull/255#discussion_r1`,
        },
        {
          path: 'docs/y.md',
          line: null,
          text: 'owner: a | b',
          url: `https://github.com/${repo}/pull/255#discussion_r2`,
        },
      ],
    },
  ];
  expect(renderSection(merged, 7)).toBe(
    [
      '### Owner findings',
      '',
      '3 owner finding(s) of agent review, on 2 pull request(s) that merged in the last 7 days. No finding held its pull request.',
      '',
      '| Pull request | File | Finding |',
      '| --- | --- | --- |',
      `| [#255](https://github.com/${repo}/pull/255) fix: a \\| b | \`tools/x.ts:12\` | [owner, weaker check (review.md, Owner findings 2). The budget rises.](https://github.com/${repo}/pull/255#discussion_r1) |`,
      `| [#255](https://github.com/${repo}/pull/255) fix: a \\| b | \`docs/y.md\` | [owner: a \\| b](https://github.com/${repo}/pull/255#discussion_r2) |`,
      `| [#254](https://github.com/${repo}/pull/254) feat: older | \`tools/z.ts:3\` | [owner: ${'x'.repeat(193)}](https://github.com/${repo}/pull/254#discussion_r9) |`,
    ].join('\n'),
  );
});

test('the section shows maxRows rows and counts the findings past them', () => {
  const findings = Array.from({ length: maxRows + 3 }, (_, index) => ({
    path: `tools/f${index}.ts`,
    line: index,
    text: `owner: finding ${index}`,
    url: `https://github.com/${repo}/pull/9#discussion_r${index}`,
  }));
  const text = renderSection([{ pull: pull(9, '2026-11-10T09:00:00Z'), findings }], 7);
  expect(text.split('\n').filter((line) => line.startsWith('| [#9]'))).toHaveLength(maxRows);
  expect(text).toContain(`3 more finding(s) not shown.`);
});

test('the section says so when no pull request has a finding', () => {
  const expected =
    '### Owner findings\n\nNo owner finding on a pull request that merged in the last 7 days.';
  expect(renderSection([], 7)).toBe(expected);
  expect(renderSection([{ pull: pull(3, '2026-11-10T09:00:00Z'), findings: [] }], 7)).toBe(
    expected,
  );
});

test('readOwnerFindings asks the repository given by --repo, with the date of today minus days', async () => {
  const calls: Array<string> = [];
  const run: Run = (command) => {
    calls.push(command.join(' '));
    let out = '';
    if (command[1] === 'pr') {
      out = JSON.stringify([pull(12, '2026-11-10T09:00:00Z')]);
    } else if (command.some((arg) => arg.includes('/reviews?'))) {
      out = JSON.stringify({ id: 1, login: bot, commit: 'head1' });
    } else if (command.some((arg) => arg.includes('/comments?'))) {
      out = JSON.stringify({
        review: 1,
        login: bot,
        path: 'tools/a.ts',
        line: 5,
        body: 'owner: check it',
        url: 'https://github.com/acme/shop/pull/12#discussion_r1',
      });
    }
    return Promise.resolve({ ok: true, out, err: '' });
  };
  const merged = await readOwnerFindings(run, 'acme/shop', 7, new Date('2026-11-12T10:00:00Z'));
  expect(merged).toHaveLength(1);
  expect(merged[0]?.findings).toHaveLength(1);
  expect(calls.some((call) => call.includes('--search merged:>=2026-11-05'))).toBe(true);
  expect(calls.some((call) => call.includes('repos/acme/shop/pulls/12/reviews?per_page=100'))).toBe(
    true,
  );
  expect(
    calls.some((call) => call.includes('repos/acme/shop/pulls/12/comments?per_page=100')),
  ).toBe(true);
  expect(calls.some((call) => call.includes('{owner}'))).toBe(false);
});
