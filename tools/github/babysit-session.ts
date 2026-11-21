import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { nothingToDo, plan } from '@tools/github/babysit';
import type { Plan } from '@tools/github/babysit';
import type { Answer } from '@tools/github/babysit-answer';
import { apply, writeLog } from '@tools/github/babysit-apply';
import type { Round } from '@tools/github/babysit-log';
import { decisionsNow, ownerAsk, ownerEvidence, ownerLeft } from '@tools/github/babysit-owner';
import { readPr } from '@tools/github/babysit-read';
import { defaultBranch, must, prWithBase, prWithHead } from '@tools/github/github';
import { stackAbove, stackChain } from '@tools/github/stack';
import type { Run } from '@tools/github/stack';
import { ownerLogin } from '@tools/github/status';

/**
 * `bun run pr babysit <number>`: one babysitter round in the session that
 * built the PR. Without `--answers`, it plans the round of each PR of the
 * stack that holds the PR, from the bottom up, prints each plan and keeps it
 * in the git directory. With `--answers`, it replies, resolves,
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

/** Plans the round for PR `number`, prints it, and keeps it for the apply step. */
async function babysitPlan(run: Run, number: string, now: string) {
  const { repo, owner, file } = await context(run, number);
  const next = plan(await readPr(run, repo, Number(number), owner), now);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 1));
  console.log(JSON.stringify(next, null, 1));
  const left = next.skip === nothingToDo && (await ownerLeft(run, repo, owner, Number(number)));
  const checks = next.ownerNow.map((check) => ({ ref: check.name }));
  for (const line of ownerEvidence(next.ownerNow)) {
    console.log(line);
  }
  const ask = ownerAsk({ repo, number, stuck: false, left, now: checks }) ?? '';
  console.log(
    next.skip
      ? `No round: ${next.skip}.${next.stuck ? ` Run \`bun run pr babysit ${number} --stuck "<why>"\` to log it.` : ''}${ask && ` ${ask}`}`
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
    const ask = ownerAsk({ repo, number, stuck: true, left: false, now: [] }) ?? '';
    // The ask carries the evidence, so the owner decides from one message.
    const evidence = ownerEvidence(kept.ownerNow).join(' ');
    console.log(
      `#${number}: stuck. ${input.stuck}${evidence && ` ${evidence}`}${ask && ` ${ask}`}`,
    );
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
  const next =
    ownerAsk({
      repo,
      number,
      stuck,
      left: !stuck && (await ownerLeft(run, repo, owner, kept.number)),
      now: decisionsNow(round.items),
    }) ?? '';
  console.log(`#${number}: ${round.outcome}. ${round.note}${next && ` ${next}`}`);
  return 0;
}

/**
 * Each open PR of the stack that holds PR `number`, from the bottom up. A PR
 * with no stack is a stack of one. When a PR below has no open PR, the stack
 * starts at `number`.
 */
async function stackOf(run: Run, number: string) {
  const view = ['gh', 'pr', 'view', number, '--json', 'headRefName,baseRefName'];
  const pr = JSON.parse(await must(run, view)) as { headRefName: string; baseRefName: string };
  const trunk = await defaultBranch(run);
  const below = await stackChain(pr.baseRefName, trunk, (head) => prWithHead(run, head)).catch(
    () => [],
  );
  const above = await stackAbove(pr.headRefName, (head) => prWithBase(run, head));
  return [...below, Number(number), ...above];
}

/** Plans the round of each PR of the stack, so a red check on a PR below the top starts a round too. */
async function babysitStack(run: Run, number: string, now: string) {
  const stack = await stackOf(run, number);
  for (const each of stack) {
    if (stack.length > 1) {
      console.log(`## #${each}`);
    }
    await babysitPlan(run, String(each), now);
  }
  return 0;
}

/** `pr babysit`: the apply step for one PR with `--answers` or `--stuck`, else the plan of its stack. */
export function babysit(
  run: Run,
  number: string,
  input: { answers?: string; pushed?: string; sync?: string; stuck?: string; now: string },
) {
  return input.answers || input.stuck
    ? babysitApply(run, number, input)
    : babysitStack(run, number, input.now);
}
