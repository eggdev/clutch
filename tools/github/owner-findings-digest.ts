/**
 * The owner findings of agent review on the pull requests that merged in the
 * last days. An owner finding holds no pull request, so the owner reads these
 * after the merge.
 *
 *   bun tools/github/owner-findings-digest.ts --repo <owner/name> [--days 7]
 *
 * It reads GitHub with the `gh` CLI, which takes its token from GH_TOKEN. See
 * docs/contributing/capabilities/factory-observability.md#weekly-digest.
 */
import { parseArgs } from 'node:util';

import { retrying } from '@tools/github/command';
import { must } from '@tools/github/github';
import { firstLine, ownerLine } from '@tools/github/owner-reviews';
import type { Run } from '@tools/github/stack';

export type Pull = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly headRefOid: string;
  readonly mergedAt: string;
};

export type Review = {
  readonly id: number;
  readonly login: string;
  readonly commit: string;
};

export type Comment = {
  readonly review: number | null;
  readonly login: string;
  readonly path: string;
  readonly line: number | null;
  readonly body: string;
  readonly url: string;
};

type Finding = {
  readonly path: string;
  readonly line: number | null;
  readonly text: string;
  readonly url: string;
};

export type Merged = {
  readonly pull: Pull;
  readonly findings: ReadonlyArray<Finding>;
};

/** The most rows the section shows. The rest are counted. */
export const maxRows = 40;

/** The longest finding text a row shows. */
const maxText = 200;

/** The most merged pull requests one run reads. */
const maxPulls = 200;

/**
 * The owner findings of the head of `pull`, each counted once. A finding is an
 * inline comment of a bot, in a review of the head commit, whose first line
 * opens an owner finding. The key is the path, the line and the first line.
 */
export function findingsOf(
  pull: Pull,
  reviews: ReadonlyArray<Review>,
  comments: ReadonlyArray<Comment>,
): Array<Finding> {
  const onHead = new Set(
    reviews.filter((review) => review.commit === pull.headRefOid).map((review) => review.id),
  );
  const seen = new Set<string>();
  const findings: Array<Finding> = [];
  for (const comment of comments) {
    const text = firstLine(comment.body);
    const counts =
      comment.login.endsWith('[bot]') &&
      comment.review !== null &&
      onHead.has(comment.review) &&
      ownerLine(text);
    const key = `${comment.path}:${comment.line}:${text}`;
    if (counts && !seen.has(key)) {
      seen.add(key);
      findings.push({
        path: comment.path,
        line: comment.line,
        text,
        url: comment.url,
      });
    }
  }
  return findings;
}

/** A finding text as a table cell: cut, with `|` escaped. */
const cell = (text: string) => text.trim().slice(0, maxText).replaceAll('|', '\\|');

/** The Markdown section of the owner findings, newest merged pull request first. */
export function renderSection(merged: ReadonlyArray<Merged>, days: number): string {
  const title = '### Owner findings';
  const withFindings = merged
    .filter((entry) => entry.findings.length > 0)
    .toSorted((a, b) => b.pull.mergedAt.localeCompare(a.pull.mergedAt));
  const total = withFindings.reduce((sum, entry) => sum + entry.findings.length, 0);
  if (total === 0) {
    return `${title}\n\nNo owner finding on a pull request that merged in the last ${days} days.`;
  }
  const rows = withFindings.flatMap((entry) =>
    entry.findings.map((finding) => {
      const pr = `[#${entry.pull.number}](${entry.pull.url}) ${entry.pull.title.replaceAll('|', '\\|')}`;
      const file = finding.line === null ? finding.path : `${finding.path}:${finding.line}`;
      return `| ${pr} | \`${file}\` | [${cell(finding.text)}](${finding.url}) |`;
    }),
  );
  const shown = rows.slice(0, maxRows);
  const more = total > maxRows ? `\n${total - maxRows} more finding(s) not shown.` : '';
  return [
    title,
    '',
    `${total} owner finding(s) of agent review, on ${withFindings.length} pull request(s) that merged in the last ${days} days. No finding held its pull request.`,
    '',
    '| Pull request | File | Finding |',
    '| --- | --- | --- |',
    ...shown,
    more,
  ]
    .join('\n')
    .trimEnd();
}

/** The lines of a `gh api` or `gh` JSON-lines answer, each parsed. */
async function lines<T>(run: Run, command: Array<string>): Promise<Array<T>> {
  const out = await must(run, command);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/**
 * The owner findings of each pull request that merged in the last `days` days,
 * counted from `now` in UTC.
 */
export async function readOwnerFindings(
  run: Run,
  repo: string,
  days: number,
  now: Date,
): Promise<Array<Merged>> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const pulls = JSON.parse(
    await must(run, [
      'gh',
      'pr',
      'list',
      '--repo',
      repo,
      '--state',
      'merged',
      '--search',
      `merged:>=${since}`,
      '--limit',
      String(maxPulls),
      '--json',
      'number,title,url,headRefOid,mergedAt',
    ]),
  ) as Array<Pull>;
  // One pull request at a time: a week can hold 200, and GitHub limits calls that run together.
  const merged: Array<Merged> = [];
  for (const pull of pulls) {
    const reviews = await lines<Review>(run, [
      'gh',
      'api',
      '--paginate',
      `repos/${repo}/pulls/${pull.number}/reviews?per_page=100`,
      '--jq',
      '.[] | {id, login: .user.login, commit: .commit_id}',
    ]);
    const comments = await lines<Comment>(run, [
      'gh',
      'api',
      '--paginate',
      `repos/${repo}/pulls/${pull.number}/comments?per_page=100`,
      '--jq',
      '.[] | {review: .pull_request_review_id, login: .user.login, path, line: (.line // .original_line), body, url: .html_url}',
    ]);
    merged.push({ pull, findings: findingsOf(pull, reviews, comments) });
  }
  return merged;
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { repo: { type: 'string' }, days: { type: 'string' } },
  });
  if (!values.repo) {
    console.error(
      'Usage: bun tools/github/owner-findings-digest.ts --repo <owner/name> [--days 7]',
    );
    process.exit(2);
  }
  const days = Number(values.days ?? 7);
  if (!Number.isInteger(days) || days < 1) {
    console.error('--days must be a whole number of at least 1.');
    process.exit(2);
  }
  try {
    const merged = await readOwnerFindings(retrying, values.repo, days, new Date());
    console.log(renderSection(merged, days));
    // The search gives the newest first, so a full page means that older ones are missing.
    if (merged.length >= maxPulls) {
      console.log(`\nOnly the ${maxPulls} newest merged pull requests were read.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
