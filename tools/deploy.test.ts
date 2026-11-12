import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { deployProblem, prove, runDeploy } from '@tools/deploy';
import { fake } from '@tools/github/fake-run';

let root = '';
const configured = 'deploy:\n  command: [bun, ship]\n  url: https://x.test\n';

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
  expect(await prove(root, gh.run, 'abc1234', () => {})).toBe(0);
  expect(gh.calls.filter((c) => c.startsWith('gh issue create'))).toEqual([]);
});

test('two production failures mark it red and ask the owner', async () => {
  await writeFile(path.join(root, 'clutch.yaml'), configured);
  const gh = fake([
    ['bun tools/journeys/run.ts', { ok: false, err: 'sign-in failed' }],
    ['gh issue list', { out: '[]' }],
    ['gh issue create', { out: 'https://github.com/a/b/issues/9\n' }],
  ]);
  expect(await prove(root, gh.run, 'abc1234', () => {})).toBe(1);
  expect(gh.calls.filter((c) => c.startsWith('gh issue create'))).toHaveLength(1);
});
