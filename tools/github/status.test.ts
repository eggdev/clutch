import { expect, test } from 'bun:test';

import { fake, findingsOn, repoOwner } from '@tools/github/fake-run';
import type { Result } from '@tools/github/stack';
import { blockingCount, prStatus, renderStatus } from '@tools/github/status';

// The bodies, reviews, comments and annotations below are copied from eggdev/clutch.
// #172 merged on a passed agent-review check, though its summary says "none blocking".
// #170 merged with 3 owner findings on its head, and its check showed 9 annotations.
const head172 = 'bf2cc8494678a5a15cde3a912e83e02300840426';
const head170 = 'b924d28d357299b47f332fd6882223100f741985';
const headOld170 = 'ad839414e71e9450f483c7d73a5d3f76eb7e50df';

const summary172 = `## Agent review

Findings (2, all \`note\`; none blocking, none \`owner\`):

- **note**: \`tools/check-test-integrity.ts\` is a guardrail file (\`tools/check-*.ts\`). The change makes the check stronger: an allow entry already at the base covers no dropped test. Rule: "A changed guardrail file".
- **note**: \`tools/test-integrity-allow.json\` is a guardrail file. The change makes the check stronger by deleting the CL-122 entry for \`tools/github/lifecycle.test.ts\`. An edit that changes an entry's reason still covers a drop. Rule: "A changed guardrail file".

Prior owner findings: none to carry over.

No weaker test, no new allow entry, no new escape hatch, and the docs page \`docs/contributing/testing.md\` changed with the behavior.`;

const check = (name: string, conclusion: string, status = 'COMPLETED') => ({
  __typename: 'CheckRun',
  name,
  status,
  conclusion,
  detailsUrl: `https://github.com/eggdev/clutch/actions/runs/1/job/${name.length}`,
});

const view = (sha: string, rollup: Array<object>): Partial<Result> => ({
  out: JSON.stringify({
    number: 7,
    url: 'https://github.com/eggdev/clutch/pull/7',
    state: 'OPEN',
    headRefOid: sha,
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    statusCheckRollup: rollup,
  }),
});

const rules: [string, Partial<Result>] = [
  'gh api repos/{owner}/{repo}/rules/branches/main',
  { out: '["validate","agent-review"]' },
];

const botComment = (body: string) => JSON.stringify({ body, login: 'github-actions[bot]' });
/** A bot comment with the time it was posted, as the issues comments API gives it. */
const dated = (body: string, createdAt: string) =>
  JSON.stringify({ body, login: 'github-actions[bot]', createdAt });
const comments = (...bodies: Array<string>) =>
  [
    'gh api --paginate repos/{owner}/{repo}/issues/7/comments',
    { out: bodies.map(botComment).join('\n') },
  ] as [string, Partial<Result>];

/** An inline review comment as the pulls comments API lists it, with the review it belongs to. */
const inline = (
  review: number,
  path: string,
  line: number,
  body: string,
  login = 'github-actions[bot]',
) => JSON.stringify({ review, login, path, line, body });
const inlineComments = (...lines: Array<string>) =>
  ['gh api --paginate repos/{owner}/{repo}/pulls/7/comments', { out: lines.join('\n') }] as [
    string,
    Partial<Result>,
  ];

/** The reviews of PR 7, as the reviews API lists them, with their ids and commits. */
const reviewList = (...reviews: Array<{ id: number; commit: string; state?: string }>) =>
  [
    'gh api --paginate repos/{owner}/{repo}/pulls/7/reviews',
    {
      out: reviews
        .map(({ id, commit, state = 'COMMENTED' }) =>
          JSON.stringify({ id, login: 'github-actions[bot]', state, commit }),
        )
        .join('\n'),
    },
  ] as [string, Partial<Result>];

test('the blocking count reads the wordings of #172 and #171', () => {
  expect(blockingCount(summary172)).toBe(0);
  expect(blockingCount('## Agent review\n\nBlocking: 0. Owner: 2.\n\n- **owner** `x.ts:1`')).toBe(
    0,
  );
  expect(
    blockingCount('## Agent review\n\nBlocking findings: 1\n\n- **blocking** `x.ts:106`'),
  ).toBe(1);
  expect(blockingCount('## Agent review\n\nNothing was written in this form.')).toBeNull();
});

test('a passed agent-review check on the head means no blocking finding, though the summary has no count', async () => {
  const gh = fake([
    [
      'gh pr view 7',
      view(head172, [check('validate', 'SUCCESS'), check('agent-review', 'SUCCESS')]),
    ],
    rules,
    comments(summary172),
  ]);
  const status = await prStatus(gh.run, '7');
  expect(status).toMatchObject({
    agentReview: { posted: true, blocking: 0, owner: 0 },
    ready: true,
  });
  expect(renderStatus(status)).toContain('Agent review: 0 blocking.');
  expect(renderStatus(status)).toContain('Ready to merge: yes');
});

test('a failed check whose summary cannot be read stays unreadable and not ready', async () => {
  const gh = fake([
    [
      'gh pr view 7',
      view(head172, [check('validate', 'SUCCESS'), check('agent-review', 'FAILURE')]),
    ],
    rules,
    comments('## Agent review\n\nSomething else.'),
  ]);
  const status = await prStatus(gh.run, '7');
  expect(status).toMatchObject({ agentReview: { blocking: null }, ready: false });
  expect(renderStatus(status)).toContain('its blocking count is unreadable');
});

test('a passed check with no review comment is not a review, because the review did not run', async () => {
  const gh = fake([
    [
      'gh pr view 7',
      view(head172, [check('validate', 'SUCCESS'), check('agent-review', 'SUCCESS')]),
    ],
    rules,
    comments(),
  ]);
  expect(await prStatus(gh.run, '7')).toMatchObject({
    agentReview: { posted: false, blocking: null },
    ready: false,
  });
});

const owner170 = [
  // The nine "Owner review needed" annotations of the agent-review run on #170's head,
  // each cut after its first clause. The run's structured answer gives three of them
  // (path:line form), and the inline owner comments of its review give the other six.
  'tools/github/lifecycle.test.ts:42 — deleted test `the owner count reads each owner bullet of the summary` (A weaker or deleted test).',
  'tools/github/status.ts:238 — owner count moves from the review comment to annotations (A weaker check).',
  "tools/github/status.ts:166 — the owner gate passes on the owner's approval of the head (A weaker check).",
  'owner: **A weaker check** (docs/contributing/review.md, "Always flag"), and `tools/github/**` is a guardrail path in `tools/guardrail-files.json`.',
  'owner: **A weaker or deleted test** (review.md, "Always flag"). The test `the owner count reads each owner bullet of the summary` is deleted.',
  'owner: **A weaker test** (review.md, "Always flag"). The deleted `merge refuses an owner finding until the owner approves` test asserted.',
  '**`owner`** (rule: A weaker or deleted test). The test `the owner count reads each owner bullet of the summary` is deleted.',
  '**`owner`** (rule: A weaker check; this file is a guardrail file under `tools/github/**`). `pr status`, `pr wait` and `pr merge` now count owner findings.',
  '**`owner`** (rule: A weaker check; `tools/github/**` is a guardrail file). The owner-finding gate used by `pr merge` and `pr status` no longer waits.',
];

const summary170 = `## Agent review

Blocking findings: 0. Owner findings: 3. Note findings: 1.

- \`owner\` (A weaker or deleted test): \`tools/github/lifecycle.test.ts:42\`. The test \`the owner count reads each owner bullet of the summary\` is deleted.
- \`owner\` (A weaker check): \`tools/github/status.ts:238\`. The owner count moves from the review comment to the annotations.
- \`owner\` (A weaker check): \`tools/github/status.ts:166\`. The owner gate passes on the owner's approval of the head.
- \`note\` (One door for each decision): \`tools/github/status.ts:125\`.

Resolved owner findings: none. No earlier owner findings were recorded.`;

/** The inline comments of #170's two reviews: the earlier head (ad83941) and the head (b924d28). */
const inline170 = [
  inline(
    5_751_080_164,
    'tools/github/merge.ts',
    137,
    'owner: **A weaker check** (docs/contributing/review.md, "Always flag"), and `tools/github/**` is a guardrail path in `tools/guardrail-files.json`.',
  ),
  inline(
    5_751_080_432,
    'tools/github/lifecycle.test.ts',
    42,
    'owner: **A weaker or deleted test** (review.md, "Always flag"). The test `the owner count reads each owner bullet of the summary` is deleted.',
  ),
  inline(
    5_751_080_695,
    'tools/github/merge.test.ts',
    77,
    'owner: **A weaker test** (review.md, "Always flag"). The deleted `merge refuses an owner finding until the owner approves` test asserted.',
  ),
  inline(
    5_751_080_981,
    'tools/github/status.ts',
    125,
    'note: **One door for each decision** (review.md). `ownerLogin` re-reads `automerge.owner` from `clutch.yaml`.',
  ),
  inline(
    5_751_133_801,
    'tools/github/lifecycle.test.ts',
    42,
    '**`owner`** (rule: A weaker or deleted test). The test `the owner count reads each owner bullet of the summary` is deleted.',
  ),
  inline(
    5_751_134_156,
    'tools/github/status.ts',
    238,
    '**`owner`** (rule: A weaker check; this file is a guardrail file under `tools/github/**`). `pr status`, `pr wait` and `pr merge` now count owner findings.',
  ),
  inline(
    5_751_134_466,
    'tools/github/status.ts',
    166,
    '**`owner`** (rule: A weaker check; `tools/github/**` is a guardrail file). The owner-finding gate used by `pr merge` and `pr status` no longer waits.',
  ),
  inline(
    5_751_134_758,
    'tools/github/status.ts',
    125,
    '**`note`** (rule: One door for each decision). `ownerLogin` and `codeownersDefault` re-implement the owner decision.',
  ),
];

const reviews170 = reviewList(
  { id: 5_751_080_164, commit: headOld170 },
  { id: 5_751_133_801, commit: head170 },
  { id: 5_751_134_156, commit: head170 },
  { id: 5_751_134_466, commit: head170 },
  { id: 5_751_134_758, commit: head170 },
);

test('the owner count is the findings of the head review, not the nine annotations of #170', async () => {
  const gh = fake([
    [
      'gh pr view 7',
      view(head170, [check('validate', 'SUCCESS'), check('agent-review', 'SUCCESS')]),
    ],
    rules,
    comments(summary170),
    ...findingsOn(head170, owner170),
    reviews170,
    inlineComments(...inline170),
  ]);
  const status = await prStatus(gh.run, '7');
  expect(status.agentReview).toEqual({ posted: true, blocking: 0, owner: 3 });
  expect(renderStatus(status)).toContain('Agent review: 0 blocking, 3 owner (advisory).');
});

test('owner findings without inline comments on the head count as the annotations do', async () => {
  const gh = fake([
    [
      'gh pr view 7',
      view(head170, [check('validate', 'SUCCESS'), check('agent-review', 'SUCCESS')]),
    ],
    rules,
    comments(summary170),
    ...findingsOn(head170, owner170.slice(0, 2)),
    reviews170,
    inlineComments(),
  ]);
  expect(await prStatus(gh.run, '7')).toMatchObject({ agentReview: { owner: 2 } });
});

test('no owner annotation means no owner finding, even with owner comments on the head', async () => {
  const gh = fake([
    [
      'gh pr view 7',
      view(head170, [check('validate', 'SUCCESS'), check('agent-review', 'SUCCESS')]),
    ],
    rules,
    comments(summary170),
    ...findingsOn(head170, []),
    reviews170,
    inlineComments(...inline170),
  ]);
  expect(await prStatus(gh.run, '7')).toMatchObject({
    agentReview: { owner: 0 },
    review: 'none required',
  });
});

test('an earlier head summary does not count when this head ran no review', async () => {
  // With no credential the run on this head posts no summary, so the latest bot summary is the earlier head's.
  const started = '2026-11-03T12:40:00Z';
  const gh = fake([
    [
      'gh pr view 7',
      view(head172, [
        check('validate', 'SUCCESS'),
        { ...check('agent-review', 'SUCCESS'), startedAt: started },
      ]),
    ],
    rules,
    [
      'gh api --paginate repos/{owner}/{repo}/issues/7/comments',
      {
        out: dated('## Agent review\n\nBlocking findings: 1', '2026-11-03T12:20:00Z'),
      },
    ],
  ]);
  const status = await prStatus(gh.run, '7');
  expect(status).toMatchObject({ agentReview: { posted: false, blocking: null }, ready: false });
  expect(renderStatus(status)).toContain('Agent review: no review yet.');
});

test('a summary posted after the run on this head started counts', async () => {
  const started = '2026-11-03T12:33:00Z';
  const gh = fake([
    [
      'gh pr view 7',
      view(head172, [
        check('validate', 'SUCCESS'),
        { ...check('agent-review', 'SUCCESS'), startedAt: started },
      ]),
    ],
    rules,
    [
      'gh api --paginate repos/{owner}/{repo}/issues/7/comments',
      { out: dated(summary172, '2026-11-03T12:36:21Z') },
    ],
  ]);
  expect(await prStatus(gh.run, '7')).toMatchObject({
    agentReview: { posted: true, blocking: 0 },
    ready: true,
  });
});

/** A PR 7 whose diff changes contract.json and whose snapshot names Note.title, with the owner's reviews `reviews`. */
const broken = (reviews: string) =>
  fake([
    [
      'gh pr view 7',
      view(head170, [check('validate', 'SUCCESS'), check('agent-review', 'SUCCESS')]),
    ],
    rules,
    comments(summary170),
    ...findingsOn(head170, []),
    [
      'gh api --paginate repos/{owner}/{repo}/pulls/7/files',
      { out: JSON.stringify({ filename: 'contract.json', patch: '' }) },
    ],
    ['gh api repos/{owner}/{repo}/contents/contract.json', { out: '{"breaks":["Note.title"]}' }],
    ['gh api --paginate repos/{owner}/{repo}/pulls/7/reviews', { out: reviews }],
  ]);

test('a PR that names a contract break is not ready, and pr status names the break', async () => {
  const gh = broken('');
  const status = await prStatus(gh.run, '7');
  expect(status).toMatchObject({ contractBreaks: ['Note.title'], ready: false });
  expect(renderStatus(status)).toContain(
    'Contract breaks: Note.title. The owner agrees to a break.',
  );
  expect(gh.calls.find((call) => call.includes('/pulls/7/reviews'))).toContain(
    `select(.user.login == "${await repoOwner()}"`,
  );
});

test("the owner's approval of the head makes a PR with a contract break ready", async () => {
  expect(await prStatus(broken(`APPROVED\t${head170}`).run, '7')).toMatchObject({
    contractBreaks: ['Note.title'],
    ready: true,
  });
  expect(await prStatus(broken(`APPROVED\t${headOld170}`).run, '7')).toMatchObject({
    ready: false,
  });
});
