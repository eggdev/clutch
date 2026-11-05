import { parseArgs } from 'node:util';

import { originRepo, runGh } from '@/doctor/remote';
import type { Gh } from '@/doctor/remote';
import { treeRoot } from '@/factory-command';
import { cutText, postScore } from '@/score/comment';
import type { Score } from '@/score/comment';
import type { Fetch } from '@/score/judge';
import { scorePull } from '@/score/run';

export type ScoreDeps = { gh?: Gh; fetch?: Fetch };

function render(score: Score) {
  const result = score.passed ? 'passes' : 'fails';
  const lines = [
    `${score.scorer} ${result} ${score.repo}#${score.pr}: ${score.label} (score ${score.score}, passing score ${score.passingScore}).`,
    score.reason,
    `Judge ${score.judge}, ${score.seconds} s, head ${score.head.slice(0, 7)}.`,
  ];
  if (score.cuts.length > 0) {
    lines.push(`Cut to fit the model: ${cutText(score.cuts)}.`);
  }
  return lines.join('\n');
}

async function run(args: Array<string>, cwd: string, deps: ScoreDeps) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      pr: { type: 'string' },
      root: { type: 'string' },
      repo: { type: 'string' },
      json: { type: 'boolean', default: false },
      post: { type: 'boolean', default: false },
      sample: { type: 'boolean', default: false },
    },
  });
  const [scorer, ...extra] = positionals;
  if (!scorer || extra.length > 0) {
    throw new Error('Name one scorer: clutch score <scorer> --pr <number>.');
  }
  const pr = Number(values.pr);
  if (!/^\d+$/u.test(values.pr ?? '') || pr < 1) {
    throw new Error('--pr takes the number of a pull request.');
  }
  const gh = deps.gh ?? runGh;
  const root = await treeRoot(cwd, values.root);
  const repo = values.repo ?? (await originRepo(cwd));
  if (!repo) {
    throw new Error('No GitHub origin remote. Pass --repo OWNER/NAME.');
  }
  const result = await scorePull({
    root: root.dir,
    scorer,
    repo,
    pr,
    gh,
    sample: values.sample,
    fetch: deps.fetch,
  });
  if (result.status === 'skipped') {
    const message = `${scorer} skips ${repo}#${pr}: it is outside the ${result.samplingRate}% sample.`;
    console.log(
      values.json
        ? JSON.stringify({ schemaVersion: 1, status: 'skipped', scorer, repo, pr })
        : message,
    );
    return 0;
  }
  const { score } = result;
  const comment = values.post ? await postScore(gh, score) : undefined;
  if (values.json) {
    console.log(JSON.stringify({ schemaVersion: 1, status: 'scored', ...score, comment }, null, 2));
    return 0;
  }
  console.log(render(score));
  if (comment) {
    console.log(`${comment.edited ? 'Edited' : 'Posted'} ${comment.url}`);
  }
  return 0;
}

/**
 * `clutch score <scorer> --pr <n>`: a model from models.yaml judges one pull
 * request with the scorer's prompt and labels. It exits 0 with a score, also
 * a score that fails, and 1 when it cannot score.
 */
export async function scoreCommand(
  args: Array<string>,
  cwd: string,
  deps: ScoreDeps = {},
): Promise<number> {
  try {
    return await run(args, cwd, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.includes('--json')) {
      console.log(JSON.stringify({ schemaVersion: 1, status: 'error', message }));
    } else {
      console.error(message);
    }
    return 1;
  }
}
