import type { PullCommit } from '@/metrics/factory';

/** A GET of one route, and of every page of a list route. */
type Get = <T>(route: string) => Promise<T>;
type List = <T>(route: string, key?: string) => Promise<Array<T>>;

/** A commit as `pulls/<n>/commits` and `commits` list it. */
export type ApiPullCommit = {
  sha: string;
  parents: Array<{ sha: string }>;
  author: { login?: string; type?: string } | null | undefined;
  commit: { message: string; author?: { name?: string; date?: string } | null };
};

/** The workflow file of agent review, which `clutch sync` ships to each project. */
const agentReviewWorkflow = 'agent-review.yml';

/** The conclusions of an agent review that ran to its end. */
const reviewedConclusions = new Set(['success', 'failure', 'neutral']);

const inProgressLine = /^\+status: ['"]?in_progress['"]?\s*$/mu;

/**
 * The issue id of a pull request: the `(ID)` at the end of its title, else an
 * id such as `cl-141` at the start of a part of its branch name.
 */
export function issueIdOf(title: string, headRef: string) {
  const fromTitle = /\(([A-Z][A-Z0-9]*-\d+[a-z]?)\)\s*$/u.exec(title)?.[1];
  if (fromTitle) {
    return fromTitle;
  }
  const fromBranch = /(?:^|\/)([a-z]{1,5})-(\d+[a-z]?)(?:-|$)/iu.exec(headRef);
  return fromBranch ? `${fromBranch[1].toUpperCase()}-${fromBranch[2]}` : undefined;
}

export const toPullCommit = (commit: ApiPullCommit): PullCommit => ({
  sha: commit.sha,
  message: commit.commit.message,
  authoredAt: commit.commit.author?.date ?? '',
  bot:
    commit.author?.type === 'Bot' ||
    Boolean(commit.author?.login?.endsWith('[bot]')) ||
    Boolean(commit.commit.author?.name?.endsWith('[bot]')),
  merge: commit.parents.length > 1,
});

/** The reads that the factory numbers add for each merged pull request. */
export function factoryReader(repo: string, get: Get, list: List) {
  return {
    /**
     * The earliest completion of the Agent review workflow on each head
     * commit, for the runs created on or after `since`, a date. One list
     * covers every PR, so the report makes no call for each commit. A
     * cancelled run, which a newer push replaced, does not count.
     */
    async agentReviewRuns(since: string) {
      const runs = await list<{
        head_sha: string;
        status: string;
        conclusion: string | null;
        updated_at: string;
      }>(
        `repos/${repo}/actions/workflows/${agentReviewWorkflow}/runs?created=${encodeURIComponent(`>=${since}`)}`,
        'workflow_runs',
      );
      const bySha = new Map<string, string>();
      for (const run of runs) {
        const earlier = bySha.get(run.head_sha);
        if (
          run.status === 'completed' &&
          reviewedConclusions.has(run.conclusion ?? '') &&
          (!earlier || run.updated_at < earlier)
        ) {
          bySha.set(run.head_sha, run.updated_at);
        }
      }
      return bySha;
    },

    /**
     * When the issue of the pull request went `in_progress` before `before`:
     * the author date of the latest commit on the default branch that set
     * `status: in_progress` in `.clutch/issues/<id>.md`. None for a PR without
     * an issue file.
     */
    async inProgressAt(title: string, headRef: string, before: string | undefined) {
      const id = issueIdOf(title, headRef);
      if (!id || !before) {
        return null;
      }
      const file = `.clutch/issues/${id}.md`;
      const touched = await list<ApiPullCommit>(
        `repos/${repo}/commits?path=${encodeURIComponent(file)}&until=${encodeURIComponent(before)}`,
      );
      const earlier = touched
        .map(toPullCommit)
        .filter((commit) => commit.authoredAt && commit.authoredAt < before)
        .toSorted((a, b) => b.authoredAt.localeCompare(a.authoredAt))
        .slice(0, 5);
      for (const commit of earlier) {
        const detail = await get<{ files?: Array<{ filename: string; patch?: string }> }>(
          `repos/${repo}/commits/${commit.sha}`,
        );
        const patch = detail.files?.find((item) => item.filename === file)?.patch ?? '';
        if (inProgressLine.test(patch)) {
          return commit.authoredAt;
        }
      }
      return null;
    },
  };
}
