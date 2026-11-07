import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { plan } from '@tools/github/babysit';
import type { Plan } from '@tools/github/babysit';
import type { Answer } from '@tools/github/babysit-answer';
import { apply, writeLog } from '@tools/github/babysit-apply';
import type { Round } from '@tools/github/babysit-log';
import { askOwnerLast } from '@tools/github/babysit-owner';
import { readPr } from '@tools/github/babysit-read';
import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';
import { ownerLogin } from '@tools/github/status';

/**
 * `bun run pr babysit <number>`: one babysitter round in the session that
 * built the PR. Without `--answers`, it plans the round, prints the plan and
 * keeps it in the git directory. With `--answers`, it replies, resolves,
 * reruns flaky checks, writes the disposition and the `## Babysit log`, and
 * asks for the owner's review only when nothing is left. See
 * .agents/skills/babysit-pr/SKILL.md.
 */

const syncs = new Set<Round['sync']>(['none', 'merge', 'conflict-merged', 'conflict-stuck']);

async function context(run: Run, number: string) {
  const [repo, gitDir, owner] = await Promise.all([
    must(run, ['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']),
    must(run, ['git', 'rev-parse', '--absolute-git-dir']),
    ownerLogin(),
  ]);
  if (!owner) {
    throw new Error(
      'No owner to ask: set automerge.owner in clutch.yaml, or a default owner in .github/CODEOWNERS.',
    );
  }
  return { repo, owner, file: path.join(gitDir, 'clutch', `babysit-${number}.json`) };
}

/** Plans the round for PR `number`, prints it, and keeps it for the apply step. */
async function babysitPlan(run: Run, number: string, now: string) {
  const { repo, owner, file } = await context(run, number);
  const next = plan(await readPr(run, repo, Number(number), owner), now);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 1));
  console.log(JSON.stringify(next, null, 1));
  console.log(
    next.skip
      ? `No round: ${next.skip}.${next.stuck ? ` Run \`bun run pr babysit ${number} --stuck "<why>"\` to log it.` : ''}`
      : `Plan kept in ${file}. Decide each item, fix, validate and push, then run \`bun run pr babysit ${number} --answers <file>\`.`,
  );
  return 0;
}

/** Applies the session's answers to the kept plan, then asks the owner last. */
async function babysitApply(
  run: Run,
  number: string,
  input: { answers?: string; pushed?: string; sync?: string; stuck?: string; now: string },
) {
  const { repo, owner, file } = await context(run, number);
  const kept = JSON.parse(await readFile(file, 'utf-8').catch(() => 'null')) as Plan | null;
  if (kept?.number !== Number(number)) {
    throw new Error(`No kept plan for #${number}. Run \`bun run pr babysit ${number}\` first.`);
  }
  const sync = (input.sync ?? 'none') as Round['sync'];
  if (!syncs.has(sync)) {
    throw new Error(`--sync is one of ${[...syncs].join(', ')}.`);
  }
  const common = {
    at: input.now,
    run: '',
    event: 'session',
    head: kept.head,
    triggers: kept.triggers,
    pushed: null,
    cost: { usd: 0, models: [] },
  };
  if (input.stuck) {
    const round: Round = { ...common, sync, items: [], outcome: 'stuck', note: input.stuck };
    await writeLog(run, repo, owner, kept.number, round, []);
    console.log(`#${number}: stuck. ${input.stuck}`);
    return 1;
  }
  const answers = input.answers
    ? ((JSON.parse(await readFile(input.answers, 'utf-8')) as { items?: Array<Answer> }).items ??
      [])
    : [];
  const round = await apply(run, {
    repo,
    owner,
    plan: kept,
    answers,
    pushed: input.pushed ?? null,
    sync,
    cost: common.cost,
    event: common.event,
    runUrl: '',
    now: input.now,
  });
  const step = await askOwnerLast(run, repo, owner, kept.number);
  console.log(`#${number}: ${round.outcome}. ${round.note} Owner review request: ${step}.`);
  return 0;
}

/** `pr babysit`: the apply step with `--answers` or `--stuck`, else the plan. */
export function babysit(
  run: Run,
  number: string,
  input: { answers?: string; pushed?: string; sync?: string; stuck?: string; now: string },
) {
  return input.answers || input.stuck
    ? babysitApply(run, number, input)
    : babysitPlan(run, number, input.now);
}
