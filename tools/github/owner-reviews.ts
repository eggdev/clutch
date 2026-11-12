import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

type Review = { id: number; login: string; state: string; commit: string };

/**
 * The reviews on PR `number`, oldest first. The REST list gives each review's
 * commit: `gh pr view --json latestReviews` leaves it empty.
 */
export async function reviews(run: Run, number: string): Promise<Array<Review>> {
  const out = await must(run, [
    'gh',
    'api',
    '--paginate',
    `repos/{owner}/{repo}/pulls/${number}/reviews?per_page=100`,
    '--jq',
    '.[] | {id, login: .user.login, state, commit: .commit_id}',
  ]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Review);
}

type Inline = {
  review: number | null;
  login: string;
  path: string;
  line: number | null;
  body: string;
};

/** The inline review comments on PR `number`, oldest first, each with its review. */
async function inlineComments(run: Run, number: string): Promise<Array<Inline>> {
  const out = await must(run, [
    'gh',
    'api',
    '--paginate',
    `repos/{owner}/{repo}/pulls/${number}/comments?per_page=100`,
    '--jq',
    '.[] | {review: .pull_request_review_id, login: .user.login, path, line: (.line // .original_line), body}',
  ]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Inline);
}

/** The first line of a comment, after the blank lines that the agent puts before it. */
export const firstLine = (body: string) => body.trimStart().split('\n')[0] ?? '';

/** Whether a first line opens an owner finding, as the workflow's "Count every owner finding" step reads it. */
export const ownerLine = (line: string) => /^[^A-Za-z0-9]*owner(?![A-Za-z0-9])/iu.test(line);

/**
 * The owner findings of the head, each counted once: the inline owner comments
 * of the review on the head, by path, line and first line. Annotations cannot
 * be counted, since they have no path or line and repeat a finding in other
 * wording (9 for 3 findings on #170). A comment's commit moves to a later head,
 * so the review's commit says which head a comment belongs to. The annotations
 * still decide whether any owner finding exists, as auto-merge reads them.
 */
export async function ownerCount(run: Run, number: string, head: string, annotated: number) {
  if (annotated === 0) {
    return 0;
  }
  const listed = await reviews(run, number);
  const onHead = new Set(
    listed.filter((review) => review.commit === head).map((review) => review.id),
  );
  const inline = await inlineComments(run, number);
  const found = inline
    .filter(
      (comment) =>
        comment.login.endsWith('[bot]') &&
        comment.review !== null &&
        onHead.has(comment.review) &&
        ownerLine(firstLine(comment.body)),
    )
    .map((comment) => `${comment.path}:${comment.line}:${firstLine(comment.body)}`);
  const distinct = new Set(found).size;
  return distinct > 0 ? distinct : annotated;
}
