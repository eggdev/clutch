import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import type { Run } from '@tools/github/stack';

/**
 * The owner grades the auto-merge dry-run verdicts in one issue, not on each
 * PR. `calibrate` opens or updates the weekly issue that lists the ungraded
 * verdicts. `grade` reads an owner's comment on it: `agree with all` or
 * `/agree all` adds a 👍 to each listed verdict, and `/disagree #<pr>` adds a
 * 👎 to that PR's. `check` says whether a comment's author is the owner. The
 * verdicts and the owner come from `clutch metrics --verdicts --json`. See
 * .agents/skills/deliver/references/pull-requests.md#auto-merge.
 */
const usage = [
  'Usage: bun tools/github/grade-verdicts.ts calibrate [--date YYYY-MM-DD]',
  '       bun tools/github/grade-verdicts.ts check --author LOGIN',
  '       bun tools/github/grade-verdicts.ts grade --issue N --author LOGIN --body-file FILE',
].join('\n');

const root = path.resolve(import.meta.dir, '../..');

export const label = 'automerge-calibration';

type Verdict = {
  commentId: number;
  pull: number;
  url: string;
  verdict: string;
  reasons: Array<string>;
};

export type Verdicts = {
  owner: string | null;
  agreement: { streak: number };
  ungraded: Array<Verdict>;
  disagreed: Array<Verdict>;
};

/** Marks one listed verdict in the issue body, so `grade` finds its comment. */
const marker = (verdict: Verdict) => `<!-- verdict:${verdict.commentId} pull:${verdict.pull} -->`;
const listed = /<!-- verdict:(\d+) pull:(\d+) -->/gu;

const line = (verdict: Verdict) =>
  `- [ ] #${verdict.pull} ${verdict.verdict}${
    verdict.reasons.length > 0 ? `: ${verdict.reasons.join(' ')}` : ''
  } ([comment](${verdict.url})) ${marker(verdict)}`;

/** The weekly issue's title. */
export const issueTitle = (date: string) => `Auto-merge calibration: week of ${date}`;

/** The weekly issue's body: the ungraded verdicts, then the disagreed ones with a note. */
export function issueBody(verdicts: Verdicts) {
  const owner = verdicts.owner ? `@${verdicts.owner}` : 'The owner';
  return [
    `${owner}: grade the auto-merge dry-run verdicts below. Each one says whether a PR would have merged without you.`,
    '',
    '- Comment `agree with all` or `/agree all` to add a 👍 to every verdict in the list.',
    '- Comment `/disagree #<pr>` to add a 👎 to that PR. It stays on the list with a note.',
    '',
    `Agreement streak: ${verdicts.agreement.streak} in a row. P1 ends at 20.`,
    '',
    `## Ungraded (${verdicts.ungraded.length})`,
    '',
    ...(verdicts.ungraded.length > 0 ? verdicts.ungraded.map(line) : ['Nothing to grade.']),
    '',
    `## Disagreed (${verdicts.disagreed.length})`,
    '',
    ...(verdicts.disagreed.length > 0
      ? verdicts.disagreed.map((verdict) => `${line(verdict)} 👎 The owner disagreed.`)
      : ['None.']),
    '',
  ].join('\n');
}

/** What an owner's comment asks: agree with every listed verdict, or disagree with some PRs. */
export function parseGrade(text: string) {
  const agreeAll = /^\s*(?:agree with all|\/agree all)\s*$/imu.test(text);
  const disagree = [...text.matchAll(/^\s*\/disagree\s+#(\d+)\s*$/gimu)].map((match) =>
    Number(match[1]),
  );
  return { agreeAll, disagree };
}

/** The verdict comments that the issue body lists, as [comment id, pull]. */
export function listedVerdicts(body: string) {
  return [...body.matchAll(listed)].map((match) => ({
    commentId: Number(match[1]),
    pull: Number(match[2]),
    disagreed: body
      .split('\n')
      .some((row) => row.includes(match[0]) && row.includes('The owner disagreed.')),
  }));
}

async function must(run: Run, command: Array<string>) {
  const result = await run(command);
  if (!result.ok) {
    throw new Error(`${command.join(' ')} failed: ${result.err || result.out}`);
  }
  return result.out.trim();
}

async function readVerdicts(run: Run) {
  const out = await must(run, [
    'bun',
    'tools/clutch.ts',
    'metrics',
    '--verdicts',
    '--since',
    '30d',
    '--json',
  ]);
  return JSON.parse(out) as Verdicts;
}

/** The open calibration issue, or null. */
async function openIssue(run: Run) {
  const out = await must(run, [
    'gh',
    'issue',
    'list',
    '--label',
    label,
    '--state',
    'open',
    '--json',
    'number',
    '--jq',
    '.[0].number // empty',
  ]);
  return out ? Number(out) : null;
}

/**
 * Opens or updates the one calibration issue. Returns its number. A `retitle`
 * run moves the title to the week of `date`. A grading run keeps the title.
 */
async function calibrate(run: Run, date: string, write: Write, retitle: boolean) {
  const verdicts = await readVerdicts(run);
  const file = path.join(tmpdir(), `clutch-calibration-${process.pid}.md`);
  await write(file, issueBody(verdicts));
  const number = await openIssue(run);
  if (number) {
    const title = retitle ? ['--title', issueTitle(date)] : [];
    await must(run, ['gh', 'issue', 'edit', String(number), ...title, '--body-file', file]);
    return number;
  }
  await must(run, ['gh', 'label', 'create', label, '--force', '--color', 'fbca04']);
  const url = await must(run, [
    'gh',
    'issue',
    'create',
    '--title',
    issueTitle(date),
    '--body-file',
    file,
    '--label',
    label,
  ]);
  return Number(url.split('/').at(-1));
}

/** Adds the grades that an owner's comment asks for. Returns a summary line. */
async function grade(run: Run, issue: string, text: string) {
  const { agreeAll, disagree } = parseGrade(text);
  const body = await must(run, ['gh', 'issue', 'view', issue, '--json', 'body', '--jq', '.body']);
  const repo = await must(run, [
    'gh',
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '--jq',
    '.nameWithOwner',
  ]);
  const react = (commentId: number, content: '+1' | '-1') =>
    must(run, [
      'gh',
      'api',
      '--method',
      'POST',
      `repos/${repo}/issues/comments/${commentId}/reactions`,
      '-f',
      `content=${content}`,
    ]);
  let agreed = 0;
  let disagreed = 0;
  for (const verdict of listedVerdicts(body)) {
    if (disagree.includes(verdict.pull) && !verdict.disagreed) {
      await react(verdict.commentId, '-1');
      disagreed += 1;
    } else if (agreeAll && !verdict.disagreed && !disagree.includes(verdict.pull)) {
      await react(verdict.commentId, '+1');
      agreed += 1;
    }
  }
  return `Graded on the owner's instruction: 👍 on ${agreed} verdicts, 👎 on ${disagreed}.`;
}

export type Write = (file: string, text: string) => Promise<void>;

const writeFile: Write = async (file, text) => {
  await Bun.write(file, text);
};

/** Runs one mode. Returns the exit code. */
export async function runGradeVerdicts(
  args: Array<string>,
  run: Run,
  options: { write?: Write; log?: (text: string) => void; today?: Date } = {},
): Promise<number> {
  const { write = writeFile, log = console.log, today = new Date() } = options;
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      date: { type: 'string' },
      issue: { type: 'string' },
      author: { type: 'string' },
      'body-file': { type: 'string' },
    },
  });
  const [mode] = positionals;
  if (mode === 'calibrate') {
    const date = values.date ?? today.toISOString().slice(0, 10);
    const number = await calibrate(run, date, write, true);
    log(`Calibration issue #${number} is up to date.`);
    return 0;
  }
  if (mode === 'check' && values.author) {
    const { owner } = await readVerdicts(run);
    log(`owner=${owner === values.author ? 'true' : 'false'}`);
    return 0;
  }
  if (mode === 'grade' && values.issue && values.author && values['body-file']) {
    const { owner } = await readVerdicts(run);
    if (owner !== values.author) {
      log(`Only @${owner ?? 'the owner'} grades verdicts. @${values.author} is not the owner.`);
      return 0;
    }
    const text = await Bun.file(values['body-file']).text();
    const { agreeAll, disagree } = parseGrade(text);
    if (!agreeAll && disagree.length === 0) {
      log('The comment asks for no grade.');
      return 0;
    }
    const summary = await grade(run, values.issue, text);
    await must(run, ['gh', 'issue', 'comment', values.issue, '--body', summary]);
    const number = await calibrate(run, today.toISOString().slice(0, 10), write, false);
    log(`${summary} Calibration issue #${number} is up to date.`);
    return 0;
  }
  throw new Error(usage);
}

const spawn: Run = async (command) => {
  const proc = Bun.spawn(command, { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, out, err };
};

if (import.meta.main) {
  try {
    process.exit(await runGradeVerdicts(process.argv.slice(2), spawn));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
