import type { Gh } from '@/doctor/remote';
import { upsertComment } from '@/pr-comment';
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
  /** The output tokens of each call, with the reasoning, when the server reports them. */
  outputTokens: number;
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

/**
 * Adds the score comment to the pull request. When the PR already has a
 * comment from the same scorer for the same head commit, edits that comment,
 * so a second run adds no second comment.
 */
export function postScore(gh: Gh, score: Score) {
  return upsertComment({
    gh,
    repo: score.repo,
    pr: score.pr,
    body: commentBody(score),
    earlier: (body) => {
      const marker = parseScoreMarker(body);
      return marker?.scorer === score.scorer && marker.head === score.head;
    },
  });
}
