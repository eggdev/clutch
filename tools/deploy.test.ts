import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { deployProblem, prove, runDeploy } from '@tools/deploy';
import { fake } from '@tools/github/fake-run';
import type { Result } from '@tools/github/stack';

let root = '';
const configured = 'deploy:\n  command: [bun, ship]\n  url: https://x.test\n';

/** The environment of the Deploy run 500 on main. */
const actions = { GITHUB_REPOSITORY: 'acme/shop', GITHUB_RUN_ID: '500', GITHUB_REF_NAME: 'main' };

const asked = (gh: ReturnType<typeof fake>) =>
  gh.calls.some((c) => c.startsWith('gh issue create'));
const revertStarted = (gh: ReturnType<typeof fake>) =>
  gh.calls.some((c) => c.startsWith('gh workflow run revert.yml'));

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'deploy-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

async function app(tags: Array<string>) {
  await mkdir(path.join(root, 'apps/web'), { recursive: true });
  await writeFile(path.join(root, 'apps/web/package.json'), JSON.stringify({ nx: { tags } }));
}

test('a project past kickoff with an app and no deploy fails the check', async () => {
  await app(['platform:web']);
  await writeFile(path.join(root, 'clutch.yaml'), 'mode: doctor\n');
  expect(deployProblem(root)).toContain('names no `deploy:`');
  await writeFile(path.join(root, 'clutch.yaml'), configured);
  expect(deployProblem(root)).toBeNull();
});

test('the template, before kickoff, needs no deploy', async () => {
  await app(['platform:web']);
  await writeFile(path.join(root, 'KICKOFF.md'), '# Kickoff\n');
  expect(deployProblem(root)).toBeNull();
});

test('no deploy is a notice, and a failed deploy is red', async () => {
  const lines: Array<string> = [];
  expect(await runDeploy(root, fake([]).run, (l) => lines.push(l))).toBe(0);
  expect(lines[0]).toContain('No deploy');
  await writeFile(path.join(root, 'clutch.yaml'), configured);
  const failed = fake([['bun ship', { ok: false, err: 'host down' }]]);
  expect(await runDeploy(root, failed.run, (l) => lines.push(l))).toBe(1);
  expect(lines.at(-1)).toContain('host down');
});

test('a production journey that fails once and then passes is green', async () => {
  await writeFile(path.join(root, 'clutch.yaml'), configured);
  const gh = fake([['bun tools/journeys/run.ts', [{ ok: false }, { ok: true }]]]);
  expect(await prove(root, gh.run, 'abc1234', () => {}, actions)).toBe(0);
  // One flaky run starts no revert and asks no one.
  expect(gh.calls.filter((c) => c.startsWith('gh '))).toEqual([]);
});

test('two production failures outside a Deploy run mark it red and ask the owner', async () => {
  await writeFile(path.join(root, 'clutch.yaml'), configured);
  const gh = fake([
    ['bun tools/journeys/run.ts', { ok: false, err: 'sign-in failed' }],
    ['gh issue list', { out: '[]' }],
    ['gh issue create', { out: 'https://github.com/a/b/issues/9\n' }],
  ]);
  expect(await prove(root, gh.run, 'abc1234', () => {}, {})).toBe(1);
  expect(asked(gh)).toBe(true);
  expect(revertStarted(gh)).toBe(false);
});

/**
 * Production fails twice after the deploy of abc1234, the merge of #42 on a
 * branch that a PR names. The deploy before, run 499, was proven. Auto-merge
 * merged #42, unless `answers`, which come first, say otherwise.
 */
function failedTwice(answers: Array<[string, Partial<Result>]> = []) {
  return fake([
    ...answers,
    ['bun tools/journeys/run.ts', { ok: false, err: 'sign-in failed' }],
    [
      'gh api repos/acme/shop/commits/abc1234 ',
      { out: JSON.stringify({ message: 'Merge pull request #42', parents: ['a', 'b'] }) },
    ],
    ['gh api repos/acme/shop/commits/abc1234/pulls', { out: '42\n' }],
    [
      'gh api repos/acme/shop/pulls/42',
      {
        out: JSON.stringify({
          headRefName: 'fix/sign-in',
          title: 'fix(auth): keep the session',
          author: { login: 'eggdev', is_bot: false },
        }),
      },
    ],
    ['gh api repos/acme/shop/issues/42/labels', { out: 'risk/low\n' }],
    ['gh api --paginate repos/acme/shop/issues/42/comments', { out: '901\n' }],
    [
      'gh run list',
      {
        out: JSON.stringify([
          { databaseId: 501, status: 'queued', conclusion: '' },
          { databaseId: 500, status: 'in_progress', conclusion: '' },
          { databaseId: 498, status: 'completed', conclusion: 'cancelled' },
          { databaseId: 497, status: 'completed', conclusion: 'success' },
        ]),
      },
    ],
    ['gh issue list', { out: '[]' }],
    ['gh issue create', { out: 'https://github.com/acme/shop/issues/9\n' }],
  ]);
}

async function proveFailed(gh: ReturnType<typeof fake>) {
  await writeFile(path.join(root, 'clutch.yaml'), configured);
  const lines: Array<string> = [];
  const code = await prove(root, gh.run, 'abc1234', (l) => lines.push(l), actions);
  return { code, lines };
}

test('two production failures after an auto-merged PR revert it and ask no one', async () => {
  const gh = failedTwice();
  const { code, lines } = await proveFailed(gh);
  expect(code).toBe(1);
  expect(gh.calls).toContain(
    'gh api --method POST repos/acme/shop/issues/42/labels -f labels[]=revert',
  );
  expect(gh.calls).toContain('gh workflow run revert.yml --repo acme/shop --ref main -f pr=42');
  const comment = gh.calls.find((c) => c.startsWith('gh pr comment 42'));
  expect(comment).toContain('Production failed its core journeys twice');
  expect(comment).toContain('actions/runs/500');
  expect(asked(gh)).toBe(false);
  expect(lines.at(-1)).toContain('Started its revert');
});

test('two production failures after a PR that a person merged ask the owner, and revert nothing', async () => {
  const gh = failedTwice([['gh api --paginate repos/acme/shop/issues/42/comments', { out: '' }]]);
  const { code, lines } = await proveFailed(gh);
  expect(code).toBe(1);
  expect(revertStarted(gh)).toBe(false);
  expect(asked(gh)).toBe(true);
  expect(lines).toContain(
    'No automatic revert: a person merged #42, so it gets no automatic revert.',
  );
});

test('two production failures after a revert ask the owner, and start no second revert', async () => {
  const gh = failedTwice([
    [
      'gh api repos/acme/shop/pulls/42',
      {
        out: JSON.stringify({
          headRefName: 'revert/41',
          title: 'revert: fix(auth): keep the session',
          author: { login: 'clutch-release[bot]', is_bot: true },
        }),
      },
    ],
  ]);
  const { code, lines } = await proveFailed(gh);
  expect(code).toBe(1);
  expect(revertStarted(gh)).toBe(false);
  expect(gh.calls.some((c) => c.includes('labels[]=revert'))).toBe(false);
  expect(asked(gh)).toBe(true);
  expect(lines.at(-1)).toContain('#42 is itself a revert');
});

test('when the deploy before was not proven, or the revert cannot start, the owner is asked', async () => {
  const unproven = failedTwice([
    [
      'gh run list',
      {
        out: JSON.stringify([
          { databaseId: 500, status: 'in_progress', conclusion: '' },
          { databaseId: 499, status: 'completed', conclusion: 'failure' },
        ]),
      },
    ],
  ]);
  const before = await proveFailed(unproven);
  expect(before.lines.at(-1)).toContain('was not proven');
  expect(revertStarted(unproven)).toBe(false);
  expect(asked(unproven)).toBe(true);
  const refused = failedTwice([['gh workflow run', { ok: false, err: 'HTTP 403' }]]);
  const failed = await proveFailed(refused);
  expect(failed.lines.at(-1)).toContain('the revert could not start');
  expect(asked(refused)).toBe(true);
});

test('a revert that already started for the PR asks no one again', async () => {
  // The release commit after the merge deploys too, and blames the same PR.
  const gh = failedTwice([['gh api repos/acme/shop/issues/42/labels', { out: 'revert\n' }]]);
  const { lines } = await proveFailed(gh);
  expect(revertStarted(gh)).toBe(false);
  expect(asked(gh)).toBe(false);
  expect(lines.at(-1)).toContain('The revert of #42 already started');
});
