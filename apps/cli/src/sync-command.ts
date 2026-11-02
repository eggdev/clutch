import path from 'node:path';
import { parseArgs } from 'node:util';

import { clutchCheckout, projectTemplateRepo } from '@/clutch-checkout';
import { loadClutchConfig } from '@/clutch-config/load';
import { askDecisions } from '@/sync/ask';
import { defaultGraceDays, firstReleaseAfter, graceFor } from '@/sync/grace';
import type { Grace } from '@/sync/grace';
import { runSync } from '@/sync/run';
import type { SyncResult } from '@/sync/run';

const codes: Record<SyncResult['status'], number> = {
  unchanged: 0,
  synced: 0,
  planned: 2,
  decisions: 2,
};

/**
 * Whether `sync --check` may only warn: the project is behind a newer release,
 * within the grace window. That holds for a plan, and for a keep-or-take
 * decision that the new release brings. A plan or a decision at the release
 * the project already has is drift, not a new release, so it never waits.
 */
async function graceOf(root: string, template: string, result: SyncResult) {
  if (result.status === 'unchanged' || result.status === 'synced') {
    return null;
  }
  if (!result.from || !result.release) {
    return null;
  }
  if (result.from === result.release) {
    return null;
  }
  const loaded = await loadClutchConfig(root);
  const days =
    (loaded.kind === 'loaded' ? loaded.config.template.grace_days : undefined) ?? defaultGraceDays;
  return graceFor({
    from: result.from,
    to: result.release,
    firstMissing: await firstReleaseAfter(template, result.from, result.release),
    days,
    now: new Date(),
  });
}

function print(result: SyncResult) {
  for (const change of result.changes) {
    console.log(`${change.action.padEnd(6)} ${change.path}`);
  }
  for (const clash of result.mergeClashes) {
    console.log(`merged ${clash.file}: Clutch's value won for ${clash.key}. Check it.`);
  }
  if (result.status === 'decisions') {
    console.log(
      [
        'These managed files differ from both Clutch and the last sync, so the project edited them:',
        ...result.decisions.map((file) => `  ${file}`),
        'Nothing changed. Ask the owner whether to keep each edit or take the Clutch copy.',
        'Then run sync again with --keep <file> or --take <file> for each one. Never decide for the owner.',
      ].join('\n'),
    );
    return;
  }
  const verbs = {
    unchanged: 'is up to date with',
    planned: 'would move to',
    synced: 'moved to',
  } as const;
  const target = result.release ?? result.templateCommit.slice(0, 12);
  const latest = result.latest ? ', the latest release' : '';
  console.log(`The project ${verbs[result.status]} Clutch ${target}${latest}.`);
  if (result.latest && result.status === 'planned') {
    console.log('The project is behind the latest Clutch release. Run clutch sync to take it.');
  }
}

/** What to do next: after a review-only sync, or within the grace window. */
function printNext(result: SyncResult, only: string | undefined, grace: Grace | null) {
  if (only === 'review' && result.status === 'synced') {
    console.log(
      'Use setup-verification to create or reconcile .agents/skills/verify/SKILL.md, then commit the project tooling.',
    );
  }
  if (!grace) {
    return;
  }
  console.log(grace.message);
  // A GitHub annotation, so a passing check still shows the warning on the PR.
  if (grace.within && process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::warning title=Behind the latest Clutch release::${grace.message}`);
  }
}

/** `clutch sync`: moves a project to the latest Clutch release. `--check` only reports. */
export async function syncCommand(
  args: Array<string>,
  cwd: string,
  checkout?: string,
): Promise<number> {
  try {
    const { values } = parseArgs({
      args,
      options: {
        root: { type: 'string' },
        to: { type: 'string' },
        check: { type: 'boolean' },
        json: { type: 'boolean' },
        keep: { type: 'string', multiple: true },
        take: { type: 'string', multiple: true },
        only: { type: 'string' },
      },
    });
    const root = path.resolve(cwd, values.root ?? '.');
    const template = checkout ?? (await clutchCheckout(await projectTemplateRepo(root)));
    const request = {
      root,
      template,
      to: values.to,
      check: values.check,
      keep: values.keep ?? [],
      take: values.take ?? [],
      only: values.only,
    };
    let result = await runSync(request);
    // A person at a terminal answers here. An agent, CI or --json gets the list and exit 2, and never waits.
    const person = process.stdin.isTTY && process.stdout.isTTY && !values.json && !values.check;
    if (result.status === 'decisions' && person) {
      const answers = await askDecisions({
        root: request.root,
        template,
        commit: result.templateCommit,
        files: result.decisions,
      });
      if (answers) {
        // The same commit as the first run, even when a release lands in between.
        const answered = await runSync({
          ...request,
          to: result.templateCommit,
          keep: [...request.keep, ...answers.keep],
          take: [...request.take, ...answers.take],
        });
        result = { ...answered, latest: result.latest };
      }
    }
    const grace: Grace | null = values.check ? await graceOf(root, template, result) : null;
    if (values.json) {
      console.log(JSON.stringify(grace ? { ...result, grace } : result));
    } else {
      print(result);
      printNext(result, values.only, grace);
    }
    return grace?.within ? 0 : codes[result.status];
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
