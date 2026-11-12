import { emptyLog } from '@tools/github/babysit-log';
import type { PrState, Thread } from '@tools/github/babysit-read';

/** The fixtures of the babysit tests: a clean agent PR, a review thread, and the PR as GraphQL gives it. */

export const now = '2026-11-04T12:00:00Z';

export const thread = (id: string, last = 'note: rename this'): Thread => ({
  id,
  path: 'tools/x.ts',
  line: 3,
  outdated: false,
  commentId: 11,
  comments: [{ id: 11, author: 'github-actions', body: last, at: now, url: 'https://x/c11' }],
});

export const state = (fields: Partial<PrState> = {}): PrState => ({
  number: 7,
  url: 'https://github.com/acme/shop/pull/7',
  draft: false,
  open: true,
  fork: false,
  author: 'app/eggdev-clutch-bot',
  authorIsBot: true,
  head: 'abc1234def',
  headRef: 'clutch/cl-420-babysit',
  base: 'main',
  labels: [],
  mergeable: 'MERGEABLE',
  behindBy: 0,
  failed: [],
  pending: 0,
  threads: [],
  comments: [],
  approved: false,
  log: emptyLog(),
  logId: null,
  ...fields,
});

/** The PR as GitHub's GraphQL API gives it to the round after its replies. */
export const emptyGraph = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        number: 7,
        url: 'u',
        isDraft: false,
        state: 'OPEN',
        isCrossRepository: false,
        headRefOid: 'abc1234def',
        headRefName: 'clutch/cl-1-x',
        baseRefName: 'main',
        mergeable: 'MERGEABLE',
        author: { login: 'app/bot' },
        labels: { nodes: [] },
        commits: { nodes: [] },
        reviewThreads: { nodes: [] },
        oldest: { nodes: [] },
        comments: { nodes: [] },
        reviews: { nodes: [] },
      },
    },
  },
});
