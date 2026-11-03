import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

/**
 * The check runs of a commit, as the merge gate reads them. The one-way-door
 * tier lists this file with auto-merge.ts, since a check read here decides a
 * merge. It is split out so that auto-merge.ts stays within its line budget.
 */

const gh = (run: Run, ...args: Array<string>) => must(run, ['gh', ...args]);

/** The app that runs the workflows, and so reports each required check. */
export const actionsApp = 'github-actions';

/**
 * The conclusion of the latest run of each check in `names` on commit `sha`,
 * counting only runs that the GitHub Actions app reported.
 */
export async function checkConclusions(run: Run, repo: string, sha: string, names: Array<string>) {
  const out = await gh(
    run,
    'api',
    '--paginate',
    `repos/${repo}/commits/${sha}/check-runs?per_page=100`,
    '--jq',
    '.check_runs[] | {id, name, status, conclusion, app: .app.slug}',
  );
  const latest = new Map<string, { id: number; status: string; conclusion: string | null }>();
  for (const line of out.split('\n').filter(Boolean)) {
    const runInfo = JSON.parse(line) as {
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      app: string | null;
    };
    // Only the GitHub Actions app reports the required checks. A run with the
    // same name from another app, or from a token with checks: write, is no proof.
    if (runInfo.app !== actionsApp) {
      continue;
    }
    if ((latest.get(runInfo.name)?.id ?? -1) < runInfo.id) {
      latest.set(runInfo.name, runInfo);
    }
  }
  return Object.fromEntries(
    names.map((name) => {
      const found = latest.get(name);
      if (!found) {
        return [name, 'missing'];
      }
      return [name, found.status === 'completed' ? (found.conclusion ?? 'pending') : 'pending'];
    }),
  );
}
