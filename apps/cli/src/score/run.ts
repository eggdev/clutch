import { createHash } from 'node:crypto';

import type { Gh } from '@/doctor/remote';
import type { Score } from '@/score/comment';
import { askJudge } from '@/score/judge';
import type { Fetch } from '@/score/judge';
import { judgeMessages } from '@/score/prompt';
import { readPull } from '@/score/pull';
import { loadScorer } from '@/score/scorer';

/**
 * Whether a sweep scores this pull request, at `rate` percent. The choice
 * comes from a hash of the scorer, the repository and the number, so each
 * run of a sweep picks the same pull requests.
 */
export function sampled(scorer: string, repo: string, pr: number, rate: number) {
  const digest = createHash('sha256').update(`${scorer}:${repo}#${pr}`).digest();
  return digest.readUInt32BE(0) % 100 < rate;
}

export type ScoreOptions = {
  root: string;
  scorer: string;
  repo: string;
  pr: number;
  gh: Gh;
  /** Apply the scorer's samplingRate, and skip a pull request outside the sample. */
  sample?: boolean;
  fetch?: Fetch;
};

/** Scores one pull request with one scorer, or returns `skipped` outside the sample. */
export async function scorePull(
  options: ScoreOptions,
): Promise<{ status: 'scored'; score: Score } | { status: 'skipped'; samplingRate: number }> {
  const scorer = await loadScorer(options.root, options.scorer);
  if (options.sample && !sampled(scorer.name, options.repo, options.pr, scorer.samplingRate)) {
    return { status: 'skipped', samplingRate: scorer.samplingRate };
  }
  const pull = await readPull(options.gh, options.repo, options.pr);
  const { messages, cuts } = judgeMessages(scorer, pull);
  const verdict = await askJudge({
    baseUrl: scorer.judge.baseUrl,
    model: scorer.judge.id,
    messages,
    labels: scorer.labels,
    fetch: options.fetch,
  });
  const { score } = verdict.label;
  return {
    status: 'scored',
    score: {
      scorer: scorer.name,
      repo: pull.repo,
      pr: pull.number,
      url: pull.url,
      head: pull.head,
      judge: scorer.judge.id,
      label: verdict.label.value,
      score,
      passingScore: scorer.passingScore,
      passed: score >= scorer.passingScore,
      reason: verdict.reason,
      seconds: verdict.seconds,
      calls: verdict.calls,
      cuts,
    },
  };
}
