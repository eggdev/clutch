/**
 * The babysitter's trace: one living `## Babysit log` comment on each PR. Its
 * hidden JSON block holds every round, so the next round reads its own
 * history from the PR and needs no other store. The same JSON goes to a
 * workflow artifact for `clutch metrics` and the weekly digest. See
 * .agents/skills/babysit-pr/SKILL.md#the-log.
 */

const logHeading = '## Babysit log';
export const logMarker = '<!-- clutch-babysit-log';

/** What the babysitter decided for one comment, thread or check. */
export type Decision =
  | 'must-fix'
  | 'cheap-fix'
  | 'no-change'
  | 'owner'
  | 'flaky'
  | 'after-approval';

/** Why an item with no answer from the session is left open. */
export const unanswered = 'the agent gave no decision';

export type Item = {
  kind: 'thread' | 'comment' | 'check';
  /** The thread id, the comment id or the check name. */
  ref: string;
  url: string;
  author: string;
  decision: Decision;
  reason: string;
  /** What it did: `fixed in <sha>`, `replied`, `reran`, or `left for the owner`. */
  action: string;
  resolved: boolean;
  /** For a thread: its first comment's id, which `pr findings` matches. */
  commentId?: number;
  /** For a thread: the file it is on. */
  path?: string;
  /** For a thread: the first line of its first comment, which names an agent review finding's level. */
  finding?: string;
};

export type Round = {
  at: string;
  /** The workflow run, as a URL. */
  run: string;
  /** The event that dispatched the round, such as `issue_comment` or `schedule`. */
  event: string;
  triggers: Array<string>;
  head: string;
  sync: 'none' | 'merge' | 'conflict-merged' | 'conflict-stuck';
  items: Array<Item>;
  /** The commit this round pushed, or null. */
  pushed: string | null;
  cost: { usd: number; models: Array<string> };
  outcome: 'done' | 'waiting-owner' | 'stuck' | 'nothing';
  note: string;
};

export type BabysitLog = { version: 1; answered: Array<number>; rounds: Array<Round> };

/** The rounds the JSON keeps, and the rounds the comment shows. A comment holds at most 65536 characters. */
const keptRounds = 40;
const shownRounds = 8;

export const emptyLog = (): BabysitLog => ({ version: 1, answered: [], rounds: [] });

/** The log in a comment body, or an empty log when the block is missing or broken. */
export function parseLog(body: string): BabysitLog {
  const start = body.indexOf(logMarker);
  const end = body.indexOf('-->', start);
  if (start === -1 || end === -1) {
    return emptyLog();
  }
  try {
    const parsed = JSON.parse(body.slice(start + logMarker.length, end)) as BabysitLog;
    return parsed.version === 1 && Array.isArray(parsed.rounds) ? parsed : emptyLog();
  } catch {
    return emptyLog();
  }
}

/** The rounds that started on the UTC day of `now`. */
export function roundsToday(log: BabysitLog, now: string) {
  return log.rounds.filter((round) => round.at.slice(0, 10) === now.slice(0, 10)).length;
}

/** The log with one more round. Answered comment ids are kept once. */
export function addRound(log: BabysitLog, round: Round, answered: Array<number>): BabysitLog {
  return {
    version: 1,
    answered: [...new Set([...log.answered, ...answered])],
    rounds: [...log.rounds, round].slice(-keptRounds),
  };
}

/** A table cell: one line, at most 300 characters. */
const cell = (text: string) => {
  const flat = text.replaceAll('|', '\\|').replaceAll(/\s+/gu, ' ').trim();
  return flat.length > 300 ? `${flat.slice(0, 299)}…` : flat;
};

function renderRound(round: Round, index: number) {
  const lines = [
    `### Round ${index + 1}: ${round.outcome}`,
    '',
    `- When: ${round.at}, [run](${round.run}), on \`${round.event}\``,
    `- Trigger: ${round.triggers.join(', ') || 'none'}`,
    `- Head: \`${round.head.slice(0, 7)}\`${round.pushed ? `, pushed \`${round.pushed.slice(0, 7)}\`` : ''}`,
    `- Sync: ${round.sync}`,
    `- Cost: $${round.cost.usd.toFixed(3)} (${round.cost.models.join(', ') || 'no model'})`,
  ];
  if (round.note) {
    lines.push(`- Note: ${cell(round.note)}`);
  }
  if (round.items.length > 0) {
    lines.push(
      '',
      '| Item | From | Decision | Why | Done | Resolved |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const item of round.items) {
      const ref = item.url ? `[${item.kind}](${item.url})` : `${item.kind} ${cell(item.ref)}`;
      lines.push(
        `| ${ref} | ${cell(item.author)} | ${item.decision} | ${cell(item.reason)} | ${cell(item.action)} | ${item.resolved ? 'yes' : 'no'} |`,
      );
    }
  }
  return lines.join('\n');
}

/** The JSON stays under this many characters, so the comment never passes GitHub's 65536. */
const jsonLimit = 40_000;
/** The rendered rounds stay under this many characters, beside the JSON. */
const markdownLimit = 20_000;

/** The log with its oldest rounds dropped until its JSON fits. Answered ids stay. */
export function fitted(log: BabysitLog): BabysitLog {
  let { rounds } = log;
  while (rounds.length > 1 && JSON.stringify({ ...log, rounds }).length > jsonLimit) {
    rounds = rounds.slice(1);
  }
  return { ...log, rounds };
}

/** The whole comment body: the newest round first, then the hidden JSON. */
export function renderLog(log: BabysitLog) {
  const total = log.rounds.reduce((sum, round) => sum + round.cost.usd, 0);
  // The newest rounds that fit beside the JSON. The JSON and the artifacts keep the rest.
  const rounds: Array<string> = [];
  let size = 0;
  for (const [index, round] of [...log.rounds.entries()].toReversed()) {
    const text = renderRound(round, index);
    if (rounds.length >= shownRounds || (rounds.length > 0 && size + text.length > markdownLimit)) {
      break;
    }
    rounds.push(text);
    size += text.length;
  }
  return [
    logHeading,
    '',
    `${log.rounds.length} round(s), $${total.toFixed(3)} in all. The babysitter edits this comment each round. See [babysit-pr](https://github.com/eggdev/clutch/blob/main/.agents/skills/babysit-pr/SKILL.md).`,
    '',
    ...rounds.flatMap((text) => [text, '']),
    // `>` is escaped, so no text in the JSON can close the HTML comment.
    `${logMarker}${JSON.stringify(fitted(log)).replaceAll('>', '\\u003e')}-->`,
  ].join('\n');
}

/** The level an agent review finding starts with. */
const levelOf = (reason: string) =>
  /^[^A-Za-z0-9]*(blocking|owner|note)\b/iu.exec(reason)?.[1]?.toLowerCase();

/**
 * The `## Review disposition` comment that `pr findings` and `pr merge` read,
 * built from every thread the log answered. The latest answer of each thread
 * wins. See .agents/skills/deliver/references/pull-requests.md#answer-each-finding.
 */
export function renderDisposition(log: BabysitLog) {
  const latest = new Map<number, Item>();
  for (const item of log.rounds.flatMap((round) => round.items)) {
    if (item.kind === 'thread' && item.commentId) {
      latest.set(item.commentId, item);
    }
  }
  const lines = [...latest.entries()].flatMap(([id, item]) => {
    const level = levelOf(item.finding ?? '');
    if (!level) {
      return [];
    }
    let answer = `not fixed: ${item.reason || item.action}`;
    if (item.action.startsWith('fixed in')) {
      answer = item.action;
    } else if (item.decision === 'owner') {
      answer = `waits for the owner: ${item.reason}`;
    }
    return [`- ${level} \`${item.path ?? ''}\` (${id}): ${answer.replaceAll('\n', ' ')}`];
  });
  return lines.length > 0 ? ['## Review disposition', '', ...lines, ''].join('\n') : null;
}
