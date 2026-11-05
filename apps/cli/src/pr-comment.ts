import type { Gh } from '@/doctor/remote';

type ApiComment = { id: number; html_url: string; body?: string };

async function issueComments(gh: Gh, repo: string, pr: number) {
  const comments: Array<ApiComment> = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await gh([
      'api',
      `repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`,
    ]);
    if (!result.ok) {
      throw new Error(`gh api: could not list the comments of #${pr}. ${result.err.trim()}`);
    }
    const found = JSON.parse(result.out) as Array<ApiComment>;
    comments.push(...found);
    if (found.length < 100) {
      break;
    }
  }
  return comments;
}

/**
 * Adds a comment to the pull request. When `earlier` matches the body of a
 * comment that the PR already has, edits the first such comment, so a second
 * run adds no second comment.
 */
export async function upsertComment(options: {
  gh: Gh;
  repo: string;
  pr: number;
  body: string;
  earlier: (body: string) => boolean;
}) {
  const { gh, repo, pr, body } = options;
  const comments = await issueComments(gh, repo, pr);
  const earlier = comments.find((comment) => options.earlier(comment.body ?? ''));
  const route = earlier
    ? `repos/${repo}/issues/comments/${earlier.id}`
    : `repos/${repo}/issues/${pr}/comments`;
  const result = await gh(['api', '-X', earlier ? 'PATCH' : 'POST', route, '-f', `body=${body}`]);
  if (!result.ok) {
    throw new Error(`gh api ${route}: ${result.err.trim() || 'failed'}`);
  }
  const comment = JSON.parse(result.out) as ApiComment;
  return { url: comment.html_url, edited: Boolean(earlier) };
}
