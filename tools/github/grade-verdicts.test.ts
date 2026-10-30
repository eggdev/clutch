import { expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  issueBody,
  issueTitle,
  listedVerdicts,
  parseGrade,
  runGradeVerdicts,
} from '@tools/github/grade-verdicts';
import type { Verdicts } from '@tools/github/grade-verdicts';
import type { Result, Run } from '@tools/github/stack';

const verdict = (pull: number, commentId: number, reasons: Array<string> = []) => ({
  commentId,
  pull,
  url: `https://github.com/acme/shop/pull/${pull}#issuecomment-${commentId}`,
  verdict: reasons.length > 0 ? 'would not auto-merge' : 'would auto-merge',
  reasons,
});

const verdicts: Verdicts = {
  owner: 'jane',
  agreement: { streak: 19 },
  ungraded: [verdict(7, 70), verdict(8, 80, ['The risk tier is medium, not low.'])],
  disagreed: [],
};

test('the issue lists each ungraded verdict with a marker, its reasons and the streak', () => {
  const body = issueBody(verdicts);
  expect(body).toContain('@jane: grade the auto-merge dry-run verdicts below.');
  expect(body).toContain('Agreement streak: 19 in a row. P1 ends at 20.');
  expect(body).toContain(
    '- [ ] #8 would not auto-merge: The risk tier is medium, not low. ([comment](https://github.com/acme/shop/pull/8#issuecomment-80)) <!-- verdict:80 pull:8 -->',
  );
  expect(listedVerdicts(body)).toEqual([
    { commentId: 70, pull: 7, disagreed: false },
    { commentId: 80, pull: 8, disagreed: false },
  ]);
  const noted = issueBody({ ...verdicts, ungraded: [], disagreed: [verdict(9, 90)] });
  expect(noted).toContain('Nothing to grade.');
  expect(listedVerdicts(noted)).toEqual([{ commentId: 90, pull: 9, disagreed: true }]);
  expect(issueTitle('2026-11-02')).toBe('Auto-merge calibration: week of 2026-11-02');
});

test('a grade comment takes agree with all, /agree all and /disagree #<pr>', () => {
  expect(parseGrade('agree with all')).toEqual({ agreeAll: true, disagree: [] });
  expect(parseGrade('Thanks!\n/agree all\n')).toEqual({ agreeAll: true, disagree: [] });
  expect(parseGrade('/disagree #8\n/disagree #12')).toEqual({ agreeAll: false, disagree: [8, 12] });
  expect(parseGrade('I agree with all of this, mostly')).toEqual({ agreeAll: false, disagree: [] });
});

/** A fake runner. Its metrics answer is `verdicts`, and the issue body lists them. */
function fake(answers: Array<[string, Partial<Result>]> = []) {
  const calls: Array<string> = [];
  const defaults: Array<[string, Partial<Result>]> = [
    ['bun tools/clutch.ts metrics --verdicts', { out: JSON.stringify(verdicts) }],
    ['gh issue list', { out: '41\n' }],
    ['gh issue view 41', { out: issueBody(verdicts) }],
    ['gh repo view', { out: 'acme/shop\n' }],
  ];
  const run: Run = (command) => {
    const line = command.join(' ');
    calls.push(line);
    const answer = [...answers, ...defaults].find(([prefix]) => line.startsWith(prefix))?.[1];
    return Promise.resolve({ ok: true, out: '', err: '', ...answer });
  };
  return { run, calls };
}

const quiet = { write: () => Promise.resolve(), today: new Date('2026-11-02T14:00:00Z') };
const reactions = (calls: Array<string>) =>
  calls
    .filter((call) => call.includes('/reactions'))
    .map((call) => call.split(' ').slice(4).join(' '));

async function gradeWith(
  text: string,
  author = 'jane',
  answers: Array<[string, Partial<Result>]> = [],
) {
  const gh = fake(answers);
  const lines: Array<string> = [];
  const file = path.join(tmpdir(), `grade-test-${process.pid}-${author}.md`);
  await Bun.write(file, text);
  const args = ['grade', '--issue', '41', '--author', author, '--body-file', file];
  try {
    const log = (line: string) => lines.push(line);
    expect(await runGradeVerdicts(args, gh.run, { ...quiet, log })).toBe(0);
  } finally {
    await rm(file, { force: true });
  }
  return { calls: gh.calls, lines };
}

test("the owner's agree with all adds a 👍 to each listed verdict, and keeps the title", async () => {
  const { calls, lines } = await gradeWith('agree with all');
  expect(reactions(calls)).toEqual([
    'repos/acme/shop/issues/comments/70/reactions -f content=+1',
    'repos/acme/shop/issues/comments/80/reactions -f content=+1',
  ]);
  expect(calls).toContain(
    "gh issue comment 41 --body Graded on the owner's instruction: 👍 on 2 verdicts, 👎 on 0.",
  );
  expect(calls.find((call) => call.startsWith('gh issue edit 41'))).not.toContain('--title');
  expect(lines[0]).toContain('Calibration issue #41 is up to date.');
});

test('/disagree #<pr> adds a 👎 to that PR, and agree with all skips it', async () => {
  const { calls } = await gradeWith('/disagree #8\nagree with all');
  expect(reactions(calls)).toEqual([
    'repos/acme/shop/issues/comments/70/reactions -f content=+1',
    'repos/acme/shop/issues/comments/80/reactions -f content=-1',
  ]);
});

test('a comment from anyone but the owner grades nothing', async () => {
  const { calls, lines } = await gradeWith('agree with all', 'visitor');
  expect(reactions(calls)).toEqual([]);
  expect(lines).toEqual(['Only @jane grades verdicts. @visitor is not the owner.']);
});

test('calibrate updates the open issue for the week, or opens one with the label', async () => {
  const open = fake();
  expect(await runGradeVerdicts(['calibrate'], open.run, { ...quiet, log: () => {} })).toBe(0);
  expect(open.calls.find((call) => call.startsWith('gh issue edit 41'))).toContain(
    '--title Auto-merge calibration: week of 2026-11-02 --body-file',
  );
  const none = fake([
    ['gh issue list', { out: '' }],
    ['gh issue create', { out: 'https://github.com/acme/shop/issues/42\n' }],
  ]);
  const lines: Array<string> = [];
  expect(
    await runGradeVerdicts(['calibrate'], none.run, { ...quiet, log: (line) => lines.push(line) }),
  ).toBe(0);
  expect(none.calls).toContain('gh label create automerge-calibration --force --color fbca04');
  expect(none.calls.find((call) => call.startsWith('gh issue create'))).toContain(
    '--label automerge-calibration',
  );
  expect(lines).toEqual(['Calibration issue #42 is up to date.']);
});

test('check says whether the author is the owner', async () => {
  const lines: Array<string> = [];
  const log = (line: string) => lines.push(line);
  await runGradeVerdicts(['check', '--author', 'jane'], fake().run, { ...quiet, log });
  await runGradeVerdicts(['check', '--author', 'visitor'], fake().run, { ...quiet, log });
  expect(lines).toEqual(['owner=true', 'owner=false']);
});
