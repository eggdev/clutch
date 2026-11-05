import type { Gh } from '@/doctor/remote';

/** One changed file of a pull request. `patch` is missing for a binary or a very large file. */
type PullFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
};

/** The work item of a pull request: its `.clutch/issues` file at the head commit. */
type WorkItem = { id: string; file: string; text: string };

/** What a judge reads about one pull request. */
export type Pull = {
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  branch: string;
  /** The head commit. */
  head: string;
  files: Array<PullFile>;
  /** Nothing when the PR names no issue id, or the head has no file for it. */
  issue?: WorkItem;
};

type ApiPull = {
  html_url: string;
  title: string;
  body: string | null;
  head: { sha: string; ref: string };
};

/** The issue id that a PR title or its branch names, such as CL-426. */
export function issueId(title: string, branch: string) {
  const fromTitle = /\b(CL-\d{3}[a-z]?)\b/u.exec(title)?.[1];
  if (fromTitle) {
    return fromTitle;
  }
  const fromBranch = /(?:^|\/)cl-(\d{3}[a-z]?)(?:-|$)/u.exec(branch)?.[1];
  return fromBranch ? `CL-${fromBranch}` : undefined;
}

/** Reads a pull request with `gh api` GET requests only. */
export async function readPull(gh: Gh, repo: string, number: number): Promise<Pull> {
  const get = (route: string, accept?: string) =>
    gh(['api', ...(accept ? ['-H', `Accept: ${accept}`] : []), route]);
  async function json<T>(route: string): Promise<T> {
    const result = await get(route);
    if (!result.ok) {
      throw new Error(`gh api ${route}: ${result.err.trim() || 'failed'}`);
    }
    return JSON.parse(result.out) as T;
  }

  const pull = await json<ApiPull>(`repos/${repo}/pulls/${number}`);
  const files: Array<PullFile> = [];
  // GitHub lists at most 3,000 files, 100 to a page.
  for (let page = 1; page <= 30; page += 1) {
    const found = await json<Array<PullFile>>(
      `repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    files.push(...found);
    if (found.length < 100) {
      break;
    }
  }
  const id = issueId(pull.title, pull.head.ref);
  let issue: WorkItem | undefined;
  if (id) {
    const file = `.clutch/issues/${id}.md`;
    const route = `repos/${repo}/contents/${file}?ref=${pull.head.sha}`;
    const result = await get(route, 'application/vnd.github.raw');
    if (result.ok) {
      issue = { id, file, text: result.out };
    } else if (!/HTTP 404/u.test(result.err)) {
      throw new Error(`gh api ${route}: ${result.err.trim() || 'failed'}`);
    }
  }
  return {
    repo,
    number,
    url: pull.html_url,
    title: pull.title,
    body: pull.body ?? '',
    branch: pull.head.ref,
    head: pull.head.sha,
    files: files.map(({ filename, status, additions, deletions, patch }) => ({
      filename,
      status,
      additions,
      deletions,
      patch,
    })),
    issue,
  };
}
