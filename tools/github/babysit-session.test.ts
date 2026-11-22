import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { babysit } from '@tools/github/babysit-session';
import { fake } from '@tools/github/fake-run';

test('the apply step refuses a round that the plan capped, and points to --stuck', async () => {
  const gitDir = await mkdtemp(path.join(tmpdir(), 'babysit-session-'));
  try {
    await mkdir(path.join(gitDir, 'clutch'), { recursive: true });
    await writeFile(
      path.join(gitDir, 'clutch', 'babysit-7.json'),
      JSON.stringify({
        number: 7,
        head: 'h3ad',
        skip: '2 rounds on h3ad already met the same work: open-thread',
      }),
    );
    const gh = fake([
      ['gh repo view', { out: 'acme/shop\n' }],
      ['git rev-parse --absolute-git-dir', { out: `${gitDir}\n` }],
    ]);
    await expect(
      babysit(gh.run, '7', { answers: '/nonexistent.json', now: '2026-11-06T10:00:00Z' }),
    ).rejects.toThrow('No round for #7: 2 rounds on h3ad already met the same work');
    expect(gh.calls.some((call) => call.startsWith('gh api'))).toBe(false);
  } finally {
    await rm(gitDir, { recursive: true, force: true });
  }
});

/** One PR as the babysitter reads it with GraphQL: a failed check, or a person's new comment. */
const prGraph = (number: number, head: string, base: string, work: 'red' | 'comment') =>
  JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          number,
          url: `https://github.com/acme/shop/pull/${number}`,
          isDraft: false,
          state: 'OPEN',
          isCrossRepository: false,
          headRefOid: `sha${number}`,
          headRefName: head,
          baseRefName: base,
          mergeable: 'MERGEABLE',
          author: { login: 'eggdev', __typename: 'User' },
          labels: { nodes: [] },
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    contexts: {
                      nodes:
                        work === 'red'
                          ? [
                              {
                                __typename: 'CheckRun',
                                name: 'validate',
                                conclusion: 'FAILURE',
                                status: 'COMPLETED',
                                detailsUrl: '',
                              },
                            ]
                          : [],
                    },
                  },
                },
              },
            ],
          },
          reviewThreads: { nodes: [] },
          oldest: { nodes: [] },
          comments: {
            nodes:
              work === 'comment'
                ? [
                    {
                      databaseId: 9,
                      author: { login: 'eggdev', __typename: 'User' },
                      body: 'Why?',
                      createdAt: '2026-11-06T09:00:00Z',
                      url: '',
                    },
                  ]
                : [],
          },
          reviews: { nodes: [] },
        },
      },
    },
  });

test('the plan covers each PR of the stack, so a red check on the bottom PR starts a round', async () => {
  const gitDir = await mkdtemp(path.join(tmpdir(), 'babysit-stack-'));
  try {
    const bottom = 'clutch/cl-1000-fix';
    const top = 'clutch/cl-1000-fix-2';
    const gh = fake([
      ['gh repo view --json nameWithOwner', { out: 'acme/shop\n' }],
      ['gh repo view --json defaultBranchRef', { out: 'main\n' }],
      ['git rev-parse --absolute-git-dir', { out: `${gitDir}\n` }],
      [
        'gh pr view 12 --json headRefName,baseRefName',
        { out: JSON.stringify({ headRefName: top, baseRefName: bottom }) },
      ],
      [
        `gh pr list --state open --head ${bottom} `,
        { out: '[{"number":11,"baseRefName":"main","url":"u","isDraft":false}]' },
      ],
      [`gh pr list --state open --base ${top} `, { out: '[]' }],
      [
        'gh api graphql -F owner=acme -F name=shop -F number=11 ',
        { out: prGraph(11, bottom, 'main', 'red') },
      ],
      [
        'gh api graphql -F owner=acme -F name=shop -F number=12 ',
        { out: prGraph(12, top, bottom, 'comment') },
      ],
      ['gh api repos/acme/shop/compare', { out: '0' }],
    ]);
    expect(await babysit(gh.run, '12', { now: '2026-11-06T10:00:00Z' })).toBe(0);
    const kept = async (number: number) =>
      JSON.parse(
        await readFile(path.join(gitDir, 'clutch', `babysit-${number}.json`), 'utf-8'),
      ) as {
        triggers: Array<string>;
        skip: string | null;
      };
    expect(await kept(11)).toMatchObject({ triggers: ['red-check'], skip: null });
    expect(await kept(12)).toMatchObject({ triggers: ['new-comment'], skip: null });
  } finally {
    await rm(gitDir, { recursive: true, force: true });
  }
});
