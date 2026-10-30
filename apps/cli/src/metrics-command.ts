import path from 'node:path';
import { parseArgs } from 'node:util';

import { loadClutchConfig } from '@/clutch-config/load';
import { originRepo, runGh } from '@/doctor/remote';
import type { Gh } from '@/doctor/remote';
import { git } from '@/git';
import { readIssues } from '@/issues/parse';
import { metricsReport, renderMetrics } from '@/metrics/report';

/** `14d`, or a number of days. */
function windowDays(since: string) {
  const days = Number(/^(\d+)d?$/u.exec(since)?.[1]);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`--since takes a number of days, such as 14d. Got ${since}.`);
  }
  return days;
}

/** The checkout's issues, or nothing for a repository without `.clutch/issues`. */
async function localIssues(root: string) {
  try {
    const { issues } = await readIssues(root);
    return issues;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function run(args: Array<string>, cwd: string, gh: Gh) {
  const { values } = parseArgs({
    args,
    options: {
      root: { type: 'string' },
      since: { type: 'string', default: '14d' },
      repo: { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  const folder = path.resolve(cwd, values.root ?? '.');
  const top = await git(folder, 'rev-parse', '--show-toplevel');
  const root = top.ok ? top.out : folder;
  const origin = await originRepo(root);
  const repo = values.repo ?? origin;
  if (!repo) {
    throw new Error('No GitHub origin remote. Pass --repo OWNER/NAME.');
  }
  // The checkout's own settings apply only to its own repository.
  const local = repo === origin;
  const loaded = local ? await loadClutchConfig(root) : undefined;
  const config = loaded?.kind === 'loaded' ? loaded.config : undefined;
  const report = await metricsReport({
    gh,
    repo,
    days: windowDays(values.since),
    now: new Date(),
    issues: local ? await localIssues(root) : undefined,
    branchPrefix: config?.pr?.branchPrefix,
    sizeExclude: config?.pr_size?.exclude,
  });
  console.log(values.json ? JSON.stringify(report) : renderMetrics(report));
  return 0;
}

/** `clutch metrics`: flow numbers for a repository, from `gh api` GET requests. */
export async function metricsCommand(
  args: Array<string>,
  cwd: string,
  gh: Gh = runGh,
): Promise<number> {
  try {
    return await run(args, cwd, gh);
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
