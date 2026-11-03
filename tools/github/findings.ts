import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

/**
 * Every agent review finding on a PR, across all its heads, and whether each
 * one has a disposition. Agent review posts one inline comment for each
 * finding, and a new head gets a new review, so a finding from an earlier head
 * can drop out without a fix. The author answers each finding in one PR
 * comment that starts with `## Review disposition`. See
 * .agents/skills/deliver/references/pull-requests.md#answer-each-finding.
 */

/** The first line of the comment that answers the findings. */
export const dispositionHeading = '## Review disposition';

export type Level = 'blocking' | 'owner' | 'note';

export type Inline = {
  id: number;
  path: string;
  line: number | null;
  commit: string;
  body: string;
};

/** The findings on one file at one level, from every review that raised them. */
export type Finding = {
  level: Level;
  path: string;
  ids: Array<number>;
  /** Each head that raised it, oldest first. */
  heads: Array<string>;
  /** Raised by the review of the current head. */
  current: boolean;
  /** The latest comment's first sentence. */
  summary: string;
  /** The disposition line that answers it, or null. */
  disposition: string | null;
};

/** The level that a finding comment starts with, or null for a comment that is not a finding. */
export function levelOf(body: string): Level | null {
  const match = /^[^A-Za-z0-9]*(blocking|owner|note)\b/iu.exec(body.trimStart());
  return match ? (match[1]?.toLowerCase() as Level) : null;
}

function firstSentence(body: string) {
  const text = body
    .replaceAll(/\s+/gu, ' ')
    .replace(/^[^A-Za-z0-9]*(?:blocking|owner|note)\b[^A-Za-z0-9`]*/iu, '')
    .trim();
  const end = text.search(/\.\s/u);
  return (end === -1 ? text : text.slice(0, end + 1)).slice(0, 200);
}

function matchingLine(disposition: string, finding: Omit<Finding, 'disposition'>) {
  return (
    disposition
      .split('\n')
      .map((line) => line.trim())
      .find(
        (line) =>
          finding.ids.some((id) => new RegExp(`(?<!\\d)${id}(?!\\d)`, 'u').test(line)) ||
          (line.includes(finding.path) && new RegExp(`\\b${finding.level}\\b`, 'iu').test(line)),
      ) ?? null
  );
}

/**
 * The line of `disposition` that answers a finding: one that names one of its
 * comment ids, or names its path and its level. A `blocking` finding counts as
 * answered only by `fixed in <sha>`.
 */
function answer(disposition: string, finding: Omit<Finding, 'disposition'>) {
  const line = matchingLine(disposition, finding);
  // A blocking finding must not merge until it is fixed, so only a fix answers it.
  if (
    line &&
    finding.level === 'blocking' &&
    !/\bfixed in\b/iu.test(line.replaceAll(/\bnot fixed\b/giu, ''))
  ) {
    return null;
  }
  return line;
}

/** Groups the inline findings by file and level, and matches each group to the disposition. */
export function findingsOf(
  inline: ReadonlyArray<Inline>,
  head: string,
  disposition: string,
): Array<Finding> {
  const groups = new Map<string, Omit<Finding, 'disposition'>>();
  for (const comment of inline) {
    const level = levelOf(comment.body);
    if (!level) {
      continue;
    }
    const key = `${level} ${comment.path}`;
    const group = groups.get(key) ?? {
      level,
      path: comment.path,
      ids: [],
      heads: [],
      current: false,
      summary: '',
    };
    group.ids.push(comment.id);
    if (!group.heads.includes(comment.commit)) {
      group.heads.push(comment.commit);
    }
    group.current ||= comment.commit === head;
    group.summary = firstSentence(comment.body);
    groups.set(key, group);
  }
  const order: Record<Level, number> = { blocking: 0, owner: 1, note: 2 };
  return [...groups.values()]
    .map((group) => ({ ...group, disposition: answer(disposition, group) }))
    .toSorted((a, b) => order[a.level] - order[b.level] || a.path.localeCompare(b.path));
}

/** The text of the latest `## Review disposition` comment, or an empty string. */
export function latestDisposition(bodies: ReadonlyArray<string>) {
  return bodies.findLast((body) => body.trimStart().startsWith(dispositionHeading)) ?? '';
}

/** One JSON value on each line of `gh --jq` output. */
function jsonLines<T>(out: string): Array<T> {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/** The findings of PR `number`, read with 3 calls: the head, the inline comments and the PR comments. */
export async function prFindings(run: Run, number: string) {
  const head = await must(run, [
    'gh',
    'pr',
    'view',
    number,
    '--json',
    'headRefOid',
    '-q',
    '.headRefOid',
  ]);
  const inline = await must(run, [
    'gh',
    'api',
    '--paginate',
    `repos/{owner}/{repo}/pulls/${number}/comments?per_page=100`,
    '--jq',
    '.[] | select(.user.login == "github-actions[bot]" and .in_reply_to_id == null) | {id, path, line: (.line // .original_line), commit: .original_commit_id, body}',
  ]);
  const notes = await must(run, [
    'gh',
    'api',
    '--paginate',
    `repos/{owner}/{repo}/issues/${number}/comments?per_page=100`,
    '--jq',
    '.[] | .body | @json',
  ]);
  return findingsOf(jsonLines<Inline>(inline), head, latestDisposition(jsonLines<string>(notes)));
}

/** The findings with no disposition. */
export const unanswered = (findings: ReadonlyArray<Finding>) =>
  findings.filter((finding) => finding.disposition === null);

/** The findings as a list, and a disposition template for the ones with none. */
export function renderFindings(findings: ReadonlyArray<Finding>) {
  if (findings.length === 0) {
    return 'Agent review left no finding on this PR.';
  }
  const lines = findings.map((finding) => {
    const where = finding.current
      ? 'on the head'
      : `only on ${finding.heads.map((sha) => sha.slice(0, 7)).join(', ')}`;
    let answered = finding.disposition ? `answered: ${finding.disposition}` : 'NO DISPOSITION';
    if (!finding.disposition && finding.level === 'blocking') {
      answered = 'NO FIX: a blocking finding is answered only by "fixed in <sha>"';
    }
    return `- ${finding.level} ${finding.path} (${where}; ids ${finding.ids.join(', ')}): ${finding.summary}\n  ${answered}`;
  });
  const missing = unanswered(findings);
  const template =
    missing.length === 0
      ? []
      : [
          '',
          `${missing.length} finding(s) have no disposition. Fix each one, or say why not, in one PR comment:`,
          '',
          dispositionHeading,
          '',
          ...missing.map(
            (finding) =>
              `- ${finding.level} \`${finding.path}\` (${finding.ids.join(', ')}): ${finding.level === 'blocking' ? 'fixed in <sha>' : 'fixed in <sha> | not fixed: <reason> | waits for the owner: <what they decide>'}`,
          ),
        ];
  return [...lines, ...template].join('\n');
}
