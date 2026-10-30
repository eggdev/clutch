import type { Gh } from '@/doctor/remote';
import type {
  CheckRun,
  DryRunVerdict,
  MainCommit,
  MergedPull,
  WorkflowRun,
} from '@/metrics/compute';
import { enabledMarker } from '@/metrics/pulls';
import type { PullShape } from '@/metrics/pulls';
import { verdictReasons } from '@/metrics/compute';

/** The marker that starts each dry-run comment of `tools/github/auto-merge.ts`. */
const dryRunMarker = '<!-- automerge-dry-run:';

/** A person or a bot, as the GitHub API reports one. */
type Account = { login?: string; type?: string } | null | undefined;

type TimelineEvent = {
  event?: string;
  actor?: Account;
  user?: Account;
  state?: string;
  body?: string;
};
type ApiCheckRun = {
  name: string;
  status: string;
  conclusion: string | null;
  completed_at: string | null;
};
type ApiCommit = { sha: string; parents: Array<{ sha: string }>; commit: { message: string } };

/** The timeline events in which a person acts on a pull request. */
const humanEvents = new Set([
  'merged',
  'auto_merge_enabled',
  'reviewed',
  'commented',
  'review_requested',
  'ready_for_review',
]);

const isPerson = (account: Account) =>
  account?.type === 'User' && !account.login?.endsWith('[bot]');

/**
 * Reads GitHub with `gh api` GET requests only. Each call names its route, so
 * `--repo` reads any repository that the token can read.
 */
export function githubReader(gh: Gh, repo: string, concurrency = 8) {
  async function get<T>(route: string): Promise<T> {
    const result = await gh(['api', route]);
    if (!result.ok) {
      throw new Error(`gh api ${route}: ${result.err.trim() || 'failed'}`);
    }
    return JSON.parse(result.out) as T;
  }

  /**
   * Every item of a list route, 100 to a page, until a short page. `key` names
   * the array in a page object, such as `items`. Pages are fetched with
   * `page=`, not `--paginate`, so any `gh` version works.
   */
  async function list<T>(route: string, key?: string): Promise<Array<T>> {
    const items: Array<T> = [];
    for (let page = 1; page <= 100; page += 1) {
      const sep = route.includes('?') ? '&' : '?';
      const body = await get<unknown>(`${route}${sep}per_page=100&page=${page}`);
      const found = (key ? (body as Record<string, Array<T>>)[key] : body) as Array<T>;
      items.push(...found);
      if (found.length < 100) {
        break;
      }
    }
    return items;
  }

  let running = 0;
  const waiting: Array<() => void> = [];
  /** Runs `task` once fewer than `concurrency` tasks run. */
  async function limit<T>(task: () => Promise<T>) {
    if (running >= concurrency) {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    }
    running += 1;
    try {
      return await task();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  }

  function checkRuns(sha: string, filter: 'latest' | 'all') {
    return list<ApiCheckRun>(
      `repos/${repo}/commits/${sha}/check-runs?filter=${filter}`,
      'check_runs',
    );
  }

  async function mergedPull(number: number): Promise<MergedPull & PullShape> {
    const [pull, timeline, commits, files] = await Promise.all([
      get<{
        title: string;
        created_at: string;
        merged_at: string;
        merged_by: Account;
        user: Account;
        labels: Array<{ name: string }>;
        head: { sha: string; ref: string };
      }>(`repos/${repo}/pulls/${number}`),
      list<TimelineEvent>(`repos/${repo}/issues/${number}/timeline`),
      list<{ commit: { message: string } }>(`repos/${repo}/pulls/${number}/commits`),
      list<{ filename: string; additions: number; deletions: number }>(
        `repos/${repo}/pulls/${number}/files`,
      ),
    ]);
    const runs = await checkRuns(pull.head.sha, 'latest');
    const green = runs
      .filter((run) => run.conclusion === 'success' && run.completed_at)
      .map((run) => run.completed_at ?? '')
      .filter((at) => at <= pull.merged_at)
      .toSorted();
    const human =
      isPerson(pull.merged_by) ||
      timeline.some(
        (event) =>
          humanEvents.has(event.event ?? '') && (isPerson(event.actor) || isPerson(event.user)),
      );
    return {
      number,
      title: pull.title,
      createdAt: pull.created_at,
      mergedAt: pull.merged_at,
      humanAction: human,
      lastGreenAt: green.at(-1),
      commitMessages: commits.map((commit) => commit.commit.message),
      headRef: pull.head.ref,
      author: {
        login: pull.user?.login ?? '',
        bot: pull.user?.type === 'Bot' || (pull.user?.login ?? '').endsWith('[bot]'),
      },
      labels: pull.labels.map((label) => label.name),
      numstat: files
        .map((file) => `${file.additions}\t${file.deletions}\t${file.filename}`)
        .join('\n'),
      // Only a bot's marker counts, as for the dry-run comments.
      markedStep: timeline
        .filter((event) => event.event === 'commented' && !isPerson(event.user))
        .map((event) => enabledMarker.exec(event.body ?? '')?.[1])
        .findLast(Boolean),
    };
  }

  return {
    /** The default branch and its required status checks, from rulesets and branch protection. */
    async branch() {
      const { default_branch: name } = await get<{ default_branch: string }>(`repos/${repo}`);
      const rules = await get<
        Array<{ parameters?: { required_status_checks?: Array<{ context: string }> } }>
      >(`repos/${repo}/rules/branches/${name}`);
      const required = new Set(
        rules.flatMap(
          (rule) => rule.parameters?.required_status_checks?.map((check) => check.context) ?? [],
        ),
      );
      const classic = await gh(['api', `repos/${repo}/branches/${name}/protection`]);
      if (classic.ok) {
        const body = JSON.parse(classic.out) as {
          required_status_checks?: { contexts?: Array<string> };
        };
        for (const context of body.required_status_checks?.contexts ?? []) {
          required.add(context);
        }
      }
      return { name, required: [...required] };
    },

    /** The numbers of the pull requests merged on or after `since`, a date. */
    async mergedNumbers(since: string) {
      const query = encodeURIComponent(`repo:${repo} is:pr is:merged merged:>=${since}`);
      const items = await list<{ number: number }>(`search/issues?q=${query}`, 'items');
      return items.map((item) => item.number);
    },

    mergedPulls(numbers: Array<number>) {
      return Promise.all(numbers.map((number) => limit(() => mergedPull(number))));
    },

    /**
     * The first-parent commits of `branch` since `since`, oldest first, with
     * their check runs. The list starts with the last commit before the window,
     * whose message is left empty.
     */
    async mainCommits(branch: string, since: string): Promise<Array<MainCommit>> {
      const all = await list<ApiCommit>(`repos/${repo}/commits?sha=${branch}&since=${since}`);
      const bySha = new Map(all.map((commit) => [commit.sha, commit]));
      const chain: Array<{ sha: string; message: string }> = [];
      let next: ApiCommit | undefined = all[0];
      while (next) {
        chain.push({ sha: next.sha, message: next.commit.message });
        const parent: string | undefined = next.parents[0]?.sha;
        next = parent ? bySha.get(parent) : undefined;
        if (!next && parent) {
          chain.push({ sha: parent, message: '' });
        }
      }
      const withChecks = await Promise.all(
        chain.map((commit) =>
          limit(async () => {
            const runs = await checkRuns(commit.sha, 'all');
            const checks = runs.map((run): CheckRun => ({
              name: run.name,
              status: run.status,
              conclusion: run.conclusion,
              completedAt: run.completed_at,
            }));
            return { ...commit, checks };
          }),
        ),
      );
      return withChecks.toReversed();
    },

    /**
     * The dry-run verdicts commented on or after `since`, an ISO time. With an
     * `owner`, only the owner's reactions and a bot's count as grades. The
     * grading workflow is the only bot that reacts to a verdict, and it reacts
     * only on the owner's instruction. Without one, every reaction counts.
     */
    async dryRunVerdicts(since: string, owner?: string | null): Promise<Array<DryRunVerdict>> {
      const comments = await list<{
        id: number;
        html_url: string;
        body?: string;
        created_at: string;
        issue_url: string;
        reactions?: Record<string, number>;
      }>(`repos/${repo}/issues/comments?since=${encodeURIComponent(since)}`);
      const verdicts = comments.filter(
        (comment) => comment.body?.startsWith(dryRunMarker) && comment.created_at >= since,
      );
      return Promise.all(
        verdicts.map((comment) =>
          limit(async () => {
            let thumbsUp = comment.reactions?.['+1'] ?? 0;
            let thumbsDown = comment.reactions?.['-1'] ?? 0;
            if (owner) {
              const reactions = await list<{ content: string; user: Account }>(
                `repos/${repo}/issues/comments/${comment.id}/reactions`,
              );
              const graded = reactions.filter(
                (reaction) => reaction.user?.login === owner || reaction.user?.type === 'Bot',
              );
              thumbsUp = graded.filter((reaction) => reaction.content === '+1').length;
              thumbsDown = graded.filter((reaction) => reaction.content === '-1').length;
            }
            const body = comment.body ?? '';
            return {
              commentId: comment.id,
              url: comment.html_url,
              pull: Number(comment.issue_url.split('/').at(-1)),
              createdAt: comment.created_at,
              wouldMerge: !body.includes('would not auto-merge'),
              reasons: verdictReasons(body),
              thumbsUp,
              thumbsDown,
            };
          }),
        ),
      );
    },

    /** The workflow runs created on or after `since`, a date. */
    async workflowRuns(since: string): Promise<Array<WorkflowRun>> {
      const runs = await list<{
        conclusion: string | null;
        run_started_at: string;
        updated_at: string;
      }>(`repos/${repo}/actions/runs?created=${encodeURIComponent(`>=${since}`)}`, 'workflow_runs');
      return runs.map((run) => ({
        conclusion: run.conclusion,
        runStartedAt: run.run_started_at,
        updatedAt: run.updated_at,
      }));
    },
  };
}
