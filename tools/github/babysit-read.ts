import { emptyLog, logMarker, parseLog } from '@tools/github/babysit-log';
import type { BabysitLog } from '@tools/github/babysit-log';
import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

/**
 * The babysitter's read of one PR: its threads, comments, checks and log, in
 * one GraphQL call plus one compare call. See .agents/skills/babysit-pr/SKILL.md.
 */

export type Comment = { id: number; author: string; body: string; at: string; url: string };
export type Thread = {
  id: string;
  path: string;
  line: number | null;
  outdated: boolean;
  /** The first comment's id: replies go to it. */
  commentId: number;
  comments: Array<Comment>;
};
export type FailedCheck = { name: string; url: string };

export type PrState = {
  number: number;
  url: string;
  draft: boolean;
  open: boolean;
  fork: boolean;
  author: string;
  head: string;
  headRef: string;
  base: string;
  labels: Array<string>;
  mergeable: string;
  behindBy: number;
  failed: Array<FailedCheck>;
  pending: number;
  threads: Array<Thread>;
  comments: Array<Comment>;
  /** The owner's latest review approves this head. */
  approved: boolean;
  log: BabysitLog;
  logId: number | null;
};

const failing = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'ERROR',
]);

const query = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    number url isDraft state isCrossRepository headRefOid headRefName baseRefName mergeable
    author { login }
    labels(first: 30) { nodes { name } }
    commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
      __typename
      ... on CheckRun { name conclusion status detailsUrl }
      ... on StatusContext { context state targetUrl }
    } } } } } }
    reviewThreads(first: 100) { nodes { id isResolved isOutdated path line
      comments(first: 50) { nodes { databaseId author { login } body createdAt url } } } }
    comments(last: 100) { nodes { databaseId author { login } body createdAt url } }
    reviews(last: 50) { nodes { databaseId author { login } state body submittedAt url commit { oid } } }
  } } }`;

type Node = {
  databaseId: number;
  author: { login: string } | null;
  body: string;
  createdAt: string;
  url: string;
};
type Context = {
  __typename: 'CheckRun' | 'StatusContext';
  name?: string;
  conclusion?: string | null;
  status?: string;
  detailsUrl?: string | null;
  context?: string;
  state?: string;
  targetUrl?: string | null;
};
type ReviewNode = {
  databaseId: number;
  author: { login: string } | null;
  state: string;
  body: string;
  submittedAt: string;
  url: string;
  commit: { oid: string } | null;
};
type ThreadNode = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  comments: { nodes: Array<Node> };
};
type PrNode = {
  number: number;
  url: string;
  isDraft: boolean;
  state: string;
  isCrossRepository: boolean;
  headRefOid: string;
  headRefName: string;
  baseRefName: string;
  mergeable: string;
  author: { login: string } | null;
  labels: { nodes: Array<{ name: string }> };
  commits: {
    nodes: Array<{ commit: { statusCheckRollup: { contexts: { nodes: Array<Context> } } | null } }>;
  };
  reviewThreads: { nodes: Array<ThreadNode> };
  comments: { nodes: Array<Node> };
  reviews: { nodes: Array<ReviewNode> };
};
const comment = (node: Node): Comment => ({
  id: node.databaseId,
  author: node.author?.login ?? 'ghost',
  body: node.body,
  at: node.createdAt,
  url: node.url,
});

/** Reads one PR in one GraphQL call, plus one call for how far it is behind its base. */
export async function readPr(
  run: Run,
  repo: string,
  number: number,
  owner: string,
): Promise<PrState> {
  const [ownerName, name] = repo.split('/');
  const out = await must(run, [
    'gh',
    'api',
    'graphql',
    '-F',
    `owner=${ownerName}`,
    '-F',
    `name=${name}`,
    '-F',
    `number=${number}`,
    '-f',
    `query=${query}`,
  ]);
  const pr = (JSON.parse(out) as { data: { repository: { pullRequest: PrNode } } }).data.repository
    .pullRequest;
  const contexts: Array<Context> =
    pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  const failed = contexts
    .filter((c) =>
      failing.has(c.__typename === 'CheckRun' ? (c.conclusion ?? '') : (c.state ?? '')),
    )
    .map((c) => ({ name: c.name ?? c.context ?? '', url: c.detailsUrl ?? c.targetUrl ?? '' }));
  const pending = contexts.filter((c) =>
    c.__typename === 'CheckRun'
      ? c.status !== 'COMPLETED'
      : c.state === 'PENDING' || c.state === 'EXPECTED',
  ).length;
  const issueComments: Array<Comment> = pr.comments.nodes.map(comment);
  const logComment = issueComments.findLast((c) => c.body.includes(logMarker));
  // A review's own body is a comment too. An approval with no words asks for nothing.
  const reviewBodies: Array<Comment> = pr.reviews.nodes
    .filter((r) => r.body.trim())
    .map((r) => ({
      id: r.databaseId,
      author: r.author?.login ?? 'ghost',
      body: r.body,
      at: r.submittedAt,
      url: r.url,
    }));
  const ownerReview = pr.reviews.nodes.findLast(
    (r) =>
      r.author?.login === owner && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state),
  );
  const compare = await run([
    'gh',
    'api',
    `repos/${repo}/compare/${pr.baseRefName}...${pr.headRefOid}`,
    '--jq',
    '.behind_by',
  ]);
  return {
    number: pr.number,
    url: pr.url,
    draft: pr.isDraft,
    open: pr.state === 'OPEN',
    fork: pr.isCrossRepository,
    author: pr.author?.login ?? 'ghost',
    head: pr.headRefOid,
    headRef: pr.headRefName,
    base: pr.baseRefName,
    labels: pr.labels.nodes.map((l) => l.name),
    mergeable: pr.mergeable,
    behindBy: compare.ok ? Number(compare.out.trim()) || 0 : 0,
    failed,
    pending,
    threads: pr.reviewThreads.nodes
      .filter((t) => !t.isResolved)
      .map((t) => ({
        id: t.id,
        path: t.path,
        line: t.line,
        outdated: t.isOutdated,
        commentId: t.comments.nodes[0]?.databaseId ?? 0,
        comments: t.comments.nodes.map(comment),
      })),
    comments: [...issueComments, ...reviewBodies],
    approved: ownerReview?.state === 'APPROVED' && ownerReview.commit?.oid === pr.headRefOid,
    log: logComment ? parseLog(logComment.body) : emptyLog(),
    logId: logComment?.id ?? null,
  };
}
