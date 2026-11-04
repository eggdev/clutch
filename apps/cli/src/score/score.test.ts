import { expect, test } from 'bun:test';

import type { Gh } from '@/doctor/remote';
import { commentBody, parseScoreMarker, postScore, scoreMarker } from '@/score/comment';
import type { Score } from '@/score/comment';
import { parseVerdict } from '@/score/judge';
import { budget, judgeMessages } from '@/score/prompt';
import { issueId } from '@/score/pull';
import type { Pull } from '@/score/pull';
import { sampled, scorePull } from '@/score/run';
import { loadScorer } from '@/score/scorer';
import type { Scorer } from '@/score/scorer';
import { gitRepo } from '@/testing/git-repo';

const sha = 'a'.repeat(40);
const labels = [
  { value: 'complete', score: 1, description: 'Done.' },
  { value: 'partial', score: 0.5, description: 'Part.' },
  { value: 'missed', score: 0, description: 'Not done.' },
];

const scorerFile = (judge: string) =>
  `---\nagents: [implement]\njudge: ${judge}\nlabels:\n${labels
    .map((l) => `  - value: ${l.value}\n    score: ${l.score}\n    description: ${l.description}\n`)
    .join('')}passingScore: 1\nsamplingRate: 50\n---\n\nCompare the PR with its issue.\n`;

/** A factory tree whose judge `qwen` runs at `baseUrl`. */
const treeFiles = (baseUrl?: string, judge = 'qwen') => ({
  'models.yaml': `models:\n  - id: opus\n    harness: claude\n  - id: qwen\n    harness: qwen\n${baseUrl ? `    base_url: ${baseUrl}\n` : ''}`,
  'runners/box.yaml':
    'description: A box.\nmachine: box\nt3_environment: local\nworkspace: worktree\n',
  'agents/implement/agent.md':
    '---\nrole: implement\ndescription: An agent.\nharness: claude\nmodel: opus\nrunner: box\n---\n\nWork.\n',
  'scorers/fit/scorer.md': scorerFile(judge),
});

const pullJson = {
  html_url: 'https://github.com/o/r/pull/7',
  title: 'feat(cli): add a thing (CL-426)',
  body: 'It adds the thing.',
  head: { sha, ref: 'clutch/cl-426-thing' },
};
const files = [
  { filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n+x' },
];

type Call = { args: Array<string> };

/** A `gh` that answers the routes of one pull request, and records each call. */
function fakeGh(extra: (args: Array<string>) => string | null = () => null) {
  const calls: Array<Call> = [];
  const answer = (args: Array<string>) => {
    const extraOut = extra(args);
    if (extraOut !== null) {
      return { ok: true, out: extraOut, err: '' };
    }
    const route = args.at(-1) ?? '';
    if (route === 'repos/o/r/pulls/7') {
      return { ok: true, out: JSON.stringify(pullJson), err: '' };
    }
    if (route.startsWith('repos/o/r/pulls/7/files')) {
      return { ok: true, out: JSON.stringify(files), err: '' };
    }
    if (route.startsWith('repos/o/r/contents/.clutch/issues/CL-426.md')) {
      return { ok: true, out: '# CL-426\n\n## Acceptance criteria\n\n- It works.\n', err: '' };
    }
    return { ok: false, out: '', err: 'gh: Not Found (HTTP 404)' };
  };
  const gh: Gh = (args) => {
    calls.push({ args });
    return Promise.resolve(answer(args));
  };
  return { gh, calls };
}

/** An OpenAI-compatible server that gives each reply in turn, and records each request body. */
function fakeServer(replies: Array<string>) {
  const bodies: Array<Record<string, unknown>> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== '/v1/chat/completions') {
        return new Response('no', { status: 404 });
      }
      bodies.push((await request.json()) as Record<string, unknown>);
      const content = replies[Math.min(bodies.length - 1, replies.length - 1)];
      return Response.json({ choices: [{ message: { role: 'assistant', content } }] });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    bodies,
    [Symbol.dispose]: () => server.stop(true),
  };
}

test('parseVerdict reads the JSON after a think block, and names each bad reply', () => {
  const reply =
    '<think>{"label": "missed"}</think>\n```json\n{"label": "partial", "reason": " Half. "}\n```';
  expect(parseVerdict(reply, labels)).toEqual({
    verdict: { label: labels[1], reason: 'Half.' },
  });
  expect(parseVerdict('no json', labels)).toEqual({ problem: 'The reply has no JSON object.' });
  expect(parseVerdict('{"label": ', labels)).toEqual({
    problem: 'The reply has no JSON object.',
  });
  expect(parseVerdict('{label: x}', labels)).toEqual({
    problem: 'The JSON object in the reply does not parse.',
  });
  expect(parseVerdict('{"label": "great", "reason": "x"}', labels)).toEqual({
    problem: 'The label "great" is not one of: complete, partial, missed.',
  });
  expect(parseVerdict('{"label": "complete", "reason": ""}', labels)).toEqual({
    problem: 'The reply has no reason.',
  });
});

test('issueId reads the title, then the branch', () => {
  expect(issueId('feat(cli): x (CL-426)', 'other')).toBe('CL-426');
  expect(issueId('chore: x', 'clutch/cl-103b-workflow-lint')).toBe('CL-103b');
  expect(issueId('chore: x', 'clutch/flake-friction')).toBeUndefined();
});

const scorer: Scorer = {
  name: 'fit',
  prompt: 'Compare the PR with its issue.',
  labels,
  passingScore: 1,
  samplingRate: 50,
  judge: { id: 'qwen', harness: 'qwen', baseUrl: 'http://x/v1' },
};
const pull: Pull = {
  repo: 'o/r',
  number: 7,
  url: pullJson.html_url,
  title: pullJson.title,
  body: 'Body.',
  branch: pullJson.head.ref,
  head: sha,
  files,
};

test('the prompt fences the PR as data, and says which part was cut', () => {
  const small = judgeMessages(scorer, pull);
  expect(small.cuts).toEqual([]);
  const [system, user] = small.messages;
  expect(system.content).toContain('- `partial` (score 0.5): Part.');
  expect(system.content).toContain('Compare the PR with its issue.');
  expect(user.content).toContain('No work item:');
  expect(user.content).toContain('<files count="1">\nmodified a.ts (+1 -0)\n</files>');

  const big = Array.from({ length: budget.files + 5 }, (_, index) => ({
    ...files[0],
    filename: `f${index}.ts`,
    patch: `${'+line\n'.repeat(400)}`,
  }));
  const cut = judgeMessages(scorer, {
    ...pull,
    files: big,
    issue: { id: 'CL-426', file: '.clutch/issues/CL-426.md', text: '# CL-426\n' },
  });
  expect(cut.cuts.map((item) => item.part)).toEqual(['files', 'diff']);
  const text = cut.messages[1].content;
  expect(text).toContain('<work-item file=".clutch/issues/CL-426.md">\n# CL-426\n');
  expect(text).toContain(`This list is cut to ${budget.files} of ${budget.files + 5} files.`);
  expect(text).toMatch(/This diff is cut to its first \d+ of \d+ characters\.\n<diff>/u);
  expect(text.length).toBeLessThan(budget.diff + budget.files * 40 + 1000);
});

test('sampled picks the same PRs each run, and 0 and 100 are none and all', () => {
  const picks = Array.from({ length: 200 }, (_, pr) => sampled('fit', 'o/r', pr + 1, 25));
  expect(picks).toEqual(Array.from({ length: 200 }, (_, pr) => sampled('fit', 'o/r', pr + 1, 25)));
  const share = picks.filter(Boolean).length / picks.length;
  expect(share).toBeGreaterThan(0.15);
  expect(share).toBeLessThan(0.35);
  expect([1, 2, 3].map((pr) => sampled('fit', 'o/r', pr, 0))).toEqual([false, false, false]);
  expect([1, 2, 3].map((pr) => sampled('fit', 'o/r', pr, 100))).toEqual([true, true, true]);
});

test('loadScorer needs a passing tree and a model judge with a base_url', async () => {
  await using good = await gitRepo(treeFiles('http://localhost:1/v1'), { git: false });
  expect(await loadScorer(good.root, 'fit')).toMatchObject({
    name: 'fit',
    prompt: 'Compare the PR with its issue.',
    passingScore: 1,
    samplingRate: 50,
    judge: { id: 'qwen', harness: 'qwen', baseUrl: 'http://localhost:1/v1' },
  });
  await expect(loadScorer(good.root, 'other')).rejects.toThrow('No scorer other');
  await using noUrl = await gitRepo(treeFiles(), { git: false });
  await expect(loadScorer(noUrl.root, 'fit')).rejects.toThrow(
    'scorers/fit/scorer.md: judge: "qwen" runs with qwen, so its item in models.yaml needs a base_url.',
  );
  await using person = await gitRepo(treeFiles(undefined, 'brendan'), { git: false });
  await expect(loadScorer(person.root, 'fit')).rejects.toThrow('is brendan, a person');
  await using claude = await gitRepo(treeFiles(undefined, 'opus'), { git: false });
  await expect(loadScorer(claude.root, 'fit')).rejects.toThrow('has no base_url');
});

test('scorePull sends the PR to the judge, and asks again after a bad reply', async () => {
  await using tree = await gitRepo({}, { git: false });
  using server = fakeServer(['{"label": "great"}', '{"label": "partial", "reason": "Half."}']);
  for (const [file, text] of Object.entries(treeFiles(server.url))) {
    await Bun.write(`${tree.root}/t/${file}`, text);
  }
  const { gh, calls } = fakeGh();
  const result = await scorePull({ root: `${tree.root}/t`, scorer: 'fit', repo: 'o/r', pr: 7, gh });
  expect(result).toMatchObject({
    status: 'scored',
    score: {
      scorer: 'fit',
      repo: 'o/r',
      pr: 7,
      head: sha,
      judge: 'qwen',
      label: 'partial',
      score: 0.5,
      passed: false,
      reason: 'Half.',
      calls: 2,
      cuts: [],
    },
  });
  expect(calls.every((call) => call.args[0] === 'api' && !call.args.includes('-X'))).toBe(true);
  const [first, second] = server.bodies;
  expect(first).toMatchObject({
    model: 'qwen',
    temperature: 0,
    response_format: { type: 'json_object' },
  });
  const user = (first.messages as Array<{ content: string }>)[1].content;
  expect(user).toContain('<work-item file=".clutch/issues/CL-426.md">');
  expect(user).toContain('+x');
  const retry = (second.messages as Array<{ role: string; content: string }>).slice(2);
  expect(retry).toEqual([
    { role: 'assistant', content: '{"label": "great"}' },
    {
      role: 'user',
      content: expect.stringContaining('That reply is not valid. The label "great" is not one of'),
    },
  ]);

  const skipped = await scorePull({
    root: `${tree.root}/t`,
    scorer: 'fit',
    repo: 'o/r',
    pr: [1, 2, 3, 4, 5, 6].find((pr) => !sampled('fit', 'o/r', pr, 50)) ?? 0,
    gh,
    sample: true,
  });
  expect(skipped).toEqual({ status: 'skipped', samplingRate: 50 });
});

test('a judge with no valid verdict in 2 calls fails, and so does an HTTP error', async () => {
  await using tree = await gitRepo({}, { git: false });
  using server = fakeServer(['no json']);
  for (const [file, text] of Object.entries(treeFiles(server.url))) {
    await Bun.write(`${tree.root}/${file}`, text);
  }
  const options = { root: tree.root, scorer: 'fit', repo: 'o/r', pr: 7, gh: fakeGh().gh };
  await expect(scorePull(options)).rejects.toThrow('qwen gave no valid verdict in 2 calls.');
  for (const [file, text] of Object.entries(treeFiles(`${server.url}/missing`))) {
    await Bun.write(`${tree.root}/${file}`, text);
  }
  await expect(scorePull(options)).rejects.toThrow('HTTP 404');
});

const score: Score = {
  scorer: 'fit',
  repo: 'o/r',
  pr: 7,
  url: pullJson.html_url,
  head: sha,
  judge: 'qwen',
  label: 'partial',
  score: 0.5,
  passingScore: 1,
  passed: false,
  reason: 'Half.',
  seconds: 12.3,
  calls: 1,
  cuts: [{ part: 'diff', kept: 40, total: 90 }],
};

test('the marker holds the scorer, the label, the score and the head', () => {
  expect(scoreMarker(score)).toBe(`<!-- clutch-score:fit:partial:0.5:${sha} -->`);
  const body = commentBody(score);
  expect(parseScoreMarker(body)).toEqual({
    scorer: 'fit',
    label: 'partial',
    score: 0.5,
    head: sha,
  });
  expect(body).toContain('**Score `fit`** fails: `partial` (0.5, and the passing score is 1).');
  expect(body).toContain('The prompt was cut to fit the model: the diff: 40 of 90 characters.');
  expect(parseScoreMarker('<!-- clutch-score:fit:x -->')).toBeUndefined();
});

const comment = (id: number, body: string) => ({ id, html_url: `https://c/${id}`, body });

test('postScore adds a comment, and edits the one for the same scorer and head', async () => {
  let listed = [comment(1, 'Hi.'), comment(2, scoreMarker({ ...score, head: 'b'.repeat(40) }))];
  const posted = fakeGh((args) => {
    if (args.at(-1)?.startsWith('repos/o/r/issues/7/comments?')) {
      return JSON.stringify(listed);
    }
    return args.includes('-X') ? JSON.stringify(comment(9, '')) : null;
  });
  expect(await postScore(posted.gh, score)).toEqual({ url: 'https://c/9', edited: false });
  const write = posted.calls.at(-1)?.args ?? [];
  expect(write.slice(0, 4)).toEqual(['api', '-X', 'POST', 'repos/o/r/issues/7/comments']);
  expect(write.at(-1)).toBe(`body=${commentBody(score)}`);

  listed = [comment(1, 'Hi.'), comment(3, commentBody(score))];
  expect(await postScore(posted.gh, score)).toEqual({ url: 'https://c/9', edited: true });
  expect(posted.calls.at(-1)?.args.slice(0, 4)).toEqual([
    'api',
    '-X',
    'PATCH',
    'repos/o/r/issues/comments/3',
  ]);
});
