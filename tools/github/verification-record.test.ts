import { afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runPr } from '@tools/github/pr';
import type { Result, Run } from '@tools/github/stack';
import {
  buildRecord,
  gateDecision,
  renderRecord,
  stampBody,
} from '@tools/github/verification-record';

const folders: Array<string> = [];
const noWrite = () => Promise.resolve();
afterAll(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** Runs a real command in `cwd`. */
const runIn =
  (cwd: string): Run =>
  async (command) => {
    const proc = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0, out, err };
  };

const config = {
  name: 'shop',
  flows: { 'session-queue': { paths: ['packages/runtime/**'] }, 'notes-sync': {} },
};

/** A repository whose `origin/main` holds a runtime file, a doc, a journey and the verify config. */
async function repository() {
  const dir = await mkdtemp(path.join(tmpdir(), 'verification-record-'));
  folders.push(dir);
  const run = runIn(dir);
  const files: Record<string, string> = {
    'packages/runtime/queue.ts': 'export const a = 1;\n',
    'docs/guide.md': '# Guide\n',
    'features/notes/journeys/notes-sync.journey.ts': '// journey\n',
    '.agents/skills/verify/verification.json': JSON.stringify(config),
  };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), text);
  }
  const git = (...args: Array<string>) =>
    run(['git', '-c', 'user.name=T', '-c', 'user.email=t@example.test', ...args]);
  await git('init', '--quiet', '--initial-branch', 'main');
  await git('add', '.');
  await git('-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '--message', 'start');
  await git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const commit = async (file: string, text: string) => {
    await writeFile(path.join(dir, file), text);
    await git('-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '--all', '--message', file);
  };
  const tree = async (ref: string) => {
    const parsed = await run(['git', 'rev-parse', `${ref}^{tree}`]);
    return parsed.out.trim();
  };
  const evidence = path.join(dir, 'evidence');
  const receipt = async (id: string, flow: string, ofTree: string) => {
    await mkdir(path.join(evidence, 'shop', id), { recursive: true });
    const value = { action: 'run', flow, status: 'passed', revision: { tree: ofTree } };
    await writeFile(path.join(evidence, 'shop', id, 'receipt.json'), JSON.stringify(value));
  };
  return { dir, run, commit, tree, evidence, receipt };
}

test('a passing receipt for the current tree names its flow, also after a later docs commit', async () => {
  const repo = await repository();
  await repo.commit('packages/runtime/queue.ts', 'export const a = 2;\n');
  await repo.receipt('r1', 'session-queue', await repo.tree('HEAD'));
  // The changeset and the done mark of pr open are Markdown, so the receipt still counts.
  await repo.commit('docs/guide.md', '# Guide, edited\n');
  const record = await buildRecord(repo.run, repo.dir, 'main', { evidenceRoot: repo.evidence });
  expect(record).toEqual({ verified: ['session-queue'], missing: [], docsOnly: false });
  expect(renderRecord(record)).toBe('Verified: session-queue');
});

test('a receipt for an older tree does not count', async () => {
  const repo = await repository();
  await repo.receipt('r1', 'session-queue', await repo.tree('HEAD'));
  await repo.commit('packages/runtime/queue.ts', 'export const a = 2;\n');
  const record = await buildRecord(repo.run, repo.dir, 'main', { evidenceRoot: repo.evidence });
  expect(record).toEqual({ verified: [], missing: ['session-queue'], docsOnly: false });
  expect(renderRecord(record)).toBe('Verified: none; missing: session-queue');
});

test('a journey flow with no paths covers its feature folder', async () => {
  const repo = await repository();
  await repo.commit('features/notes/journeys/notes-sync.journey.ts', '// changed\n');
  const record = await buildRecord(repo.run, repo.dir, 'main', { evidenceRoot: repo.evidence });
  expect(record.missing).toEqual(['notes-sync']);
});

test('a docs-only change gives none (docs only) and no notice', async () => {
  const repo = await repository();
  await repo.commit('docs/guide.md', '# Guide, edited\n');
  const record = await buildRecord(repo.run, repo.dir, 'main', { evidenceRoot: repo.evidence });
  expect(renderRecord(record)).toBe('Verified: none (docs only)');
  expect(gateDecision('observe', record)).toEqual({});
  expect(gateDecision('enforce', record)).toEqual({});
});

test('observe prints a notice, enforce refuses with no reason and passes with one', () => {
  const missing = { verified: [], missing: ['installer'], docsOnly: false };
  expect(gateDecision('observe', missing).notice).toContain('would block this PR');
  expect(gateDecision('observe', missing).notice).toContain('installer');
  expect(gateDecision('enforce', missing).refuse).toContain('--unverified');
  expect(gateDecision('off', missing)).toEqual({});
  const excused = { ...missing, reason: 'the device host is down' };
  expect(gateDecision('enforce', excused)).toEqual({});
  expect(renderRecord(excused)).toBe(
    'Verified: none; missing: installer; unverified because: the device host is down',
  );
});

test('stampBody puts the record first in Verification, once', () => {
  const body = '## Intent\n\nX\n\n## Verification\n\nRan validate.\n\n## Risk\n\nLow\n';
  const once = stampBody(body, 'Verified: none (docs only)');
  expect(once).toBe(
    '## Intent\n\nX\n\n## Verification\n\nVerified: none (docs only)\n\nRan validate.\n\n## Risk\n\nLow\n',
  );
  expect(stampBody(once, 'Verified: installer')).toBe(
    once.replace('none (docs only)', 'installer'),
  );
  expect(stampBody('Body', 'Verified: x')).toBe('Body\n\n## Verification\n\nVerified: x\n');
});

test('two runs of pr open leave one record in the body', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'verification-body-'));
  folders.push(dir);
  const body = path.join(dir, 'body.md');
  await writeFile(body, '## Verification\n\nRan validate.\n');
  const answers: Array<[string, Partial<Result>]> = [
    ['gh repo view', { out: 'main\n' }],
    ['git branch --show-current', { out: 'cl-558\n' }],
    ['git diff --name-only --diff-filter=A', { out: '.changeset/cl-558.md\n' }],
    ['gh pr list --state open --head cl-558', { out: '[{"number":5,"url":"u","isDraft":false}]' }],
  ];
  const run: Run = (command) => {
    const line = command.join(' ');
    const answer = answers.find(([prefix]) => line.startsWith(prefix))?.[1] ?? {};
    return Promise.resolve({ ok: true, out: '', err: '', ...answer });
  };
  const open = ['open', '--title', 'docs: x', '--body-file', body];
  await runPr(open, run, noWrite);
  await runPr(open, run, noWrite);
  expect(await readFile(body, 'utf-8')).toBe(
    '## Verification\n\nVerified: none (docs only)\n\nRan validate.\n',
  );
});
