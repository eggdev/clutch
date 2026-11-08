import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { nothingToDo, plan } from '@tools/github/babysit';
import type { Plan } from '@tools/github/babysit';
import type { Answer } from '@tools/github/babysit-answer';
import { apply, writeLog } from '@tools/github/babysit-apply';
import type { Round } from '@tools/github/babysit-log';
import { decisionsNow, ownerAsk, ownerLeft } from '@tools/github/babysit-owner';
import { readPr } from '@tools/github/babysit-read';
import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';
import { ownerLogin } from '@tools/github/status';

/**
 * `bun run pr babysit <number>`: one babysitter round in the session that
 * built the PR. Without `--answers`, it plans the round, prints the plan and
 * keeps it in the git directory. With `--answers`, it replies, resolves,
 * reruns flaky checks, writes the disposition and the `## Babysit log`, and
 * says when to ask the owner in this session's thread. See
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

/**
 * Whether this is the first time the session asks `key`. The owner stops once
 * for each ask, so a second round on the same head does not ask again.
 */
export async function firstAsk(planFile: string, number: string, key: string) {
  const file = path.join(path.dirname(planFile), `asked-${number}.txt`);
  const asked = await readFile(file, 'utf-8').catch(() => '');
  await writeFile(file, key);
  return asked.trim() !== key;
}

/** Prints an ask the first time, and tells a later round not to repeat it. */
async function askOnce(file: string, number: string, ask: ReturnType<typeof ownerAsk>) {
  if (!ask) {
    return '';
  }
  return (await firstAsk(file, number, ask.key))
    ? ` ${ask.text}`
    : ' A round on this head already printed this ask. Ask only if no session has asked yet.';
}

/** Plans the round for PR `number`, prints it, and keeps it for the apply step. */
async function babysitPlan(run: Run, number: string, now: string) {
  const { repo, owner, file } = await context(run, number);
  const next = plan(await readPr(run, repo, Number(number), owner), now);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 1));
  console.log(JSON.stringify(next, null, 1));
  const left = next.skip === nothingToDo && (await ownerLeft(run, repo, owner, Number(number)));
  const ask = await askOnce(
    file,
    number,
    ownerAsk({ repo, number, head: next.head, stuck: false, left, now: [] }),
  );
  console.log(
    next.skip
      ? `No round: ${next.skip}.${next.stuck ? ` Run \`bun run pr babysit ${number} --stuck "<why>"\` to log it.` : ''}${ask}`
      : `Plan kept in ${file}. Decide each item, fix, validate and push, then run \`bun run pr babysit ${number} --answers <file>\`.`,
  );
  return 0;
}

/** Applies the session's answers to the kept plan, then says whether the owner is needed. */
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
    const ask = await askOnce(
      file,
      number,
      ownerAsk({ repo, number, head: kept.head, stuck: true, left: false, now: [] }),
    );
    console.log(`#${number}: stuck. ${input.stuck}${ask}`);
    return 1;
  }
  // The plan's caps hold the apply step too: a skipped round only logs as stuck.
  if (kept.skip) {
    throw new Error(
      `No round for #${number}: ${kept.skip}. Log it with \`bun run pr babysit ${number} --stuck "<why>"\`.`,
    );
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
  const stuck = round.outcome === 'stuck';
  const next = await askOnce(
    file,
    number,
    ownerAsk({
      repo,
      number,
      head: kept.head,
      stuck,
      left: !stuck && (await ownerLeft(run, repo, owner, kept.number)),
      now: decisionsNow(round.items),
    }),
  );
  console.log(`#${number}: ${round.outcome}. ${round.note}${next}`);
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
