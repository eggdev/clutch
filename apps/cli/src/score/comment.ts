import type { Gh } from '@/doctor/remote';
import type { Cut } from '@/score/prompt';

/** One score of one pull request, as `clutch score` prints and posts it. */
export type Score = {
  scorer: string;
  repo: string;
  pr: number;
  url: string;
  head: string;
  judge: string;
  label: string;
  score: number;
  passingScore: number;
  passed: boolean;
  reason: string;
  seconds: number;
  calls: number;
  cuts: Array<Cut>;
};

const markerPattern =
  /<!-- clutch-score:([a-z0-9-]+):([a-z0-9_-]+):(\d+(?:\.\d+)?):([0-9a-f]{40}) -->/u;

/** The marker that starts a score comment. A reader finds the score in it. */
export const scoreMarker = (score: Pick<Score, 'scorer' | 'label' | 'score' | 'head'>) =>
  `<!-- clutch-score:${score.scorer}:${score.label}:${score.score}:${score.head} -->`;

/** The scorer, label, score and head commit in a comment's marker, or nothing. */
export function parseScoreMarker(body: string) {
  const match = markerPattern.exec(body);
  if (!match) {
    return;
  }
  const [, scorer, label, score, head] = match;
  return { scorer, label, score: Number(score), head };
}

/** One line for each part of the prompt that was cut, such as "the diff: 40000 of 91234 characters". */
export function cutText(cuts: Array<Cut>) {
  return cuts
    .map(
      (cut) =>
        `the ${cut.part}: ${cut.kept} of ${cut.total} ${cut.part === 'files' ? 'files' : 'characters'}`,
    )
    .join(', ');
}

export function commentBody(score: Score) {
  const result = score.passed ? 'passes' : 'fails';
  const lines = [
    scoreMarker(score),
    `**Score \`${score.scorer}\`** ${result}: \`${score.label}\` (${score.score}, and the passing score is ${score.passingScore}).`,
    '',
    score.reason,
    '',
    `The judge was \`${score.judge}\`, at the head commit ${score.head.slice(0, 7)}, in ${score.seconds} s. \`clutch score\` posted this comment.`,
  ];
  if (score.cuts.length > 0) {
    lines.push(`The prompt was cut to fit the model: ${cutText(score.cuts)}.`);
  }
  return `${lines.join('\n')}\n`;
}

type ApiComment = { id: number; html_url: string; body?: string };

/**
 * Adds the score comment to the pull request. When the PR already has a
 * comment from the same scorer for the same head commit, edits that comment,
 * so a second run adds no second comment.
 */
export async function postScore(gh: Gh, score: Score) {
  const comments: Array<ApiComment> = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await gh([
      'api',
      `repos/${score.repo}/issues/${score.pr}/comments?per_page=100&page=${page}`,
    ]);
    if (!result.ok) {
      throw new Error(`gh api: could not list the comments of #${score.pr}. ${result.err.trim()}`);
    }
    const found = JSON.parse(result.out) as Array<ApiComment>;
    comments.push(...found);
    if (found.length < 100) {
      break;
    }
  }
  const earlier = comments.find((comment) => {
    const marker = parseScoreMarker(comment.body ?? '');
    return marker?.scorer === score.scorer && marker.head === score.head;
  });
  const route = earlier
    ? `repos/${score.repo}/issues/comments/${earlier.id}`
    : `repos/${score.repo}/issues/${score.pr}/comments`;
  const result = await gh([
    'api',
    '-X',
    earlier ? 'PATCH' : 'POST',
    route,
    '-f',
    `body=${commentBody(score)}`,
  ]);
  if (!result.ok) {
    throw new Error(`gh api ${route}: ${result.err.trim() || 'failed'}`);
  }
  const comment = JSON.parse(result.out) as ApiComment;
  return { url: comment.html_url, edited: Boolean(earlier) };
}
