import { afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runPr } from '@tools/github/pr';
import type { Result, Run } from '@tools/github/stack';
import type { VerificationRecord } from '@tools/github/verification-record';
import {
  buildRecord,
  gateDecision,
  incompletePrefix,
  recordVerification,
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

/** Git that finds the base and fails each diff. */
const noDiff: Run = (command) =>
  Promise.resolve({ ok: command[1] !== 'diff', out: '', err: 'fatal: no merge base' });

const r = (due: Array<string>, verified: Array<string>, docsOnly = false, reason?: string) =>
  ({ due, verified, docsOnly, ...(reason ? { reason } : {}) }) as VerificationRecord;

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
    'other/tool.ts': 'export const b = 1;\n',
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
  const receipt = async (id: string, flow: string, ofTree: string, extra: object = {}) => {
    await mkdir(path.join(evidence, 'shop', id), { recursive: true });
    const value = { action: 'run', flow, status: 'passed', revision: { tree: ofTree }, ...extra };
    await writeFile(path.join(evidence, 'shop', id, 'receipt.json'), JSON.stringify(value));
  };
  const record = () => buildRecord(run, dir, 'main', { evidenceRoot: evidence });
  return { dir, run, commit, tree, receipt, record };
}

test('a passing receipt for the current tree names its flow, also after a later docs commit', async () => {
  const repo = await repository();
  await repo.commit('packages/runtime/queue.ts', 'export const a = 2;\n');
  await repo.receipt('r1', 'session-queue', await repo.tree('HEAD'));
  // A passing receipt of a flow that is not due stays out of the record.
  await repo.receipt('r2', 'notes-sync', await repo.tree('HEAD'));
  // The changeset and the done mark of pr open are Markdown, so the receipt still counts.
  await repo.commit('docs/guide.md', '# Guide, edited\n');
  const record = await repo.record();
  expect(record).toEqual({ due: ['session-queue'], verified: ['session-queue'], docsOnly: false });
  expect(renderRecord(record)).toBe('Verified: session-queue');
});

test('a receipt counts until a file that its flow covers changes', async () => {
  const repo = await repository();
  await repo.commit('packages/runtime/queue.ts', 'export const a = 2;\n');
  const verified = await repo.tree('HEAD');
  await repo.receipt('r1', 'session-queue', verified);
  // A merge of the base that brings a file outside the flow keeps the receipt.
  await repo.commit('other/tool.ts', 'export const b = 2;\n');
  const found = await repo.record();
  expect(found.verified).toEqual(['session-queue']);
  await repo.commit('packages/runtime/queue.ts', 'export const a = 3;\n');
  expect(renderRecord(await repo.record())).toBe('Verified: incomplete (missing: session-queue)');
});

test('a receipt with an unknown, stale or changed tree does not count', async () => {
  const repo = await repository();
  await repo.commit('packages/runtime/queue.ts', 'export const a = 2;\n');
  const tree = await repo.tree('HEAD');
  await repo.receipt('r1', 'session-queue', 'a'.repeat(40));
  await repo.receipt('r2', 'session-queue', tree, { stale: true });
  await repo.receipt('r3', 'session-queue', tree, { revisionAfter: { tree: 'b'.repeat(40) } });
  const found = await repo.record();
  expect(found.verified).toEqual([]);
});

test('a journey flow with no paths covers its feature folder', async () => {
  const repo = await repository();
  await repo.commit('features/notes/journeys/notes-sync.journey.ts', '// changed\n');
  const found = await repo.record();
  expect(found.due).toEqual(['notes-sync']);
});

test('a PR cannot remove a flow from the map for itself', async () => {
  const repo = await repository();
  const weaker = { ...config, flows: { 'notes-sync': {} } };
  await repo.commit('.agents/skills/verify/verification.json', JSON.stringify(weaker));
  await repo.commit('packages/runtime/queue.ts', 'export const a = 2;\n');
  const found = await repo.record();
  expect(found.due).toEqual(['session-queue']);
});

test('a missing base or a failed diff throws, and never reads as docs only', async () => {
  const repo = await repository();
  await expect(buildRecord(repo.run, repo.dir, 'gone')).rejects.toThrow('Cannot find origin/gone');
  await expect(buildRecord(noDiff, repo.dir, 'main')).rejects.toThrow('fatal: no merge base');
});

test('a docs-only change gives docs-only and no notice', async () => {
  const repo = await repository();
  await repo.commit('docs/guide.md', '# Guide, edited\n');
  const record = await repo.record();
  expect(renderRecord(record)).toBe('Verified: docs-only');
  expect(gateDecision('observe', record)).toEqual({});
  expect(gateDecision('enforce', record)).toEqual({});
});

test('each record form, and only an incomplete one, matches the query', () => {
  const forms: Array<[VerificationRecord, string]> = [
    [r(['a', 'b'], ['a', 'b']), 'Verified: a, b'],
    [r([], [], true), 'Verified: docs-only'],
    [r(['a', 'b'], ['a']), 'Verified: incomplete (passed: a; missing: b)'],
    [r(['b'], []), 'Verified: incomplete (missing: b)'],
    [r([], []), 'Verified: incomplete (no flow covers these files)'],
    [r(['b'], [], false, 'x'), 'Verified: incomplete (missing: b; unverified because: x)'],
  ];
  for (const [record, line] of forms) {
    expect(renderRecord(record)).toBe(line);
    const full =
      record.docsOnly || (record.due.length > 0 && record.verified.length === record.due.length);
    expect(line.startsWith(incompletePrefix)).toBe(!full);
  }
});

test('observe prints a notice, enforce refuses with no reason and passes with one', () => {
  const missing = { due: ['installer'], verified: [], docsOnly: false };
  expect(gateDecision('observe', missing).notice).toContain(
    'would block this PR: no passing receipt on this tree for installer',
  );
  expect(gateDecision('enforce', missing).refuse).toContain('--unverified');
  expect(gateDecision('off', missing)).toEqual({});
  expect(gateDecision('enforce', { ...missing, reason: 'the device host is down' })).toEqual({});
});

test('the reason enters the record only when a flow is missing', async () => {
  const repo = await repository();
  await repo.commit('packages/runtime/queue.ts', 'export const a = 2;\n');
  const options = { evidenceRoot: path.join(repo.dir, 'evidence'), reason: 'host  down' };
  const found = await buildRecord(repo.run, repo.dir, 'main', options);
  expect(found.reason).toBe('host down');
  await repo.receipt('r1', 'session-queue', await repo.tree('HEAD'));
  const passed = await buildRecord(repo.run, repo.dir, 'main', options);
  expect(passed.reason).toBeUndefined();
});

test('stampBody puts the record first in Verification, once', () => {
  const body =
    '## Intent\n\nVerified: everything\n\n## Verification\n\nRan validate.\n\n## Risk\n\nLow\n';
  const once = stampBody(body, 'Verified: docs-only');
  expect(once).toBe(
    '## Intent\n\n\n## Verification\n\nVerified: docs-only\n\nRan validate.\n\n## Risk\n\nLow\n',
  );
  expect(stampBody(once, 'Verified: installer')).toBe(once.replace('docs-only', 'installer'));
  expect(stampBody('Body', 'Verified: x')).toBe('Body\n\n## Verification\n\nVerified: x\n');
  expect(stampBody('A\r\n## Verification\r\nB\r\n', 'Verified: x')).toBe(
    'A\r\n## Verification\r\n\r\nVerified: x\r\n\r\nB\r\n',
  );
});

/** A fake `run` for the whole pr open path, which logs each command. */
function fakeGit(gate: string, files: string, log: Array<string> = [], baseGate = gate) {
  const map = JSON.stringify(config);
  const answers: Array<[string, Partial<Result>]> = [
    ['gh repo view', { out: 'main\n' }],
    ['git branch --show-current', { out: 'cl-558\n' }],
    ['git diff --name-only origin/main...HEAD', { out: files }],
    ['git diff --name-only --diff-filter=A', { out: '.changeset/cl-558.md\n' }],
    ['git show HEAD:clutch.yaml', { out: `verification:\n  gate: ${gate}\n` }],
    ['git show origin/main:clutch.yaml', { out: `verification:\n  gate: ${baseGate}\n` }],
    ['git show HEAD:.agents', { out: map }],
    ['git show origin/main:.agents', { out: map }],
    ['gh pr list --state open --head cl-558', { out: '[{"number":5,"url":"u","isDraft":false}]' }],
  ];
  const run: Run = (command) => {
    const line = command.join(' ');
    log.push(line);
    const answer = answers.find(([prefix]) => line.startsWith(prefix))?.[1] ?? {};
    return Promise.resolve({ ok: true, out: '', err: '', ...answer });
  };
  return run;
}

async function bodyFile(text: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'verification-body-'));
  folders.push(dir);
  const file = path.join(dir, 'body.md');
  await writeFile(file, text);
  return file;
}

test('two runs of pr open leave one record in the body', async () => {
  const body = await bodyFile('## Verification\n\nRan validate.\n');
  const run = fakeGit('observe', 'docs/x.md\n');
  const open = ['open', '--title', 'docs: x', '--body-file', body];
  await runPr(open, run, noWrite);
  await runPr(open, run, noWrite);
  expect(await readFile(body, 'utf-8')).toBe(
    '## Verification\n\nVerified: docs-only\n\nRan validate.\n',
  );
});

test('enforce refuses in pr open before any commit, changeset, tracker change or push', async () => {
  const body = await bodyFile('## Verification\n');
  const log: Array<string> = [];
  const writes: Array<string> = [];
  const write = (file: string) => {
    writes.push(file);
    return Promise.resolve();
  };
  const evidence = process.env.DELIVERY_EVIDENCE_ROOT;
  process.env.DELIVERY_EVIDENCE_ROOT = path.dirname(body);
  const open = ['open', '--title', 'fix: x', '--body-file', body];
  try {
    const run = fakeGit('enforce', 'packages/runtime/queue.ts\n', log);
    await expect(runPr(open, run, write)).rejects.toThrow('gate blocks this PR');
    expect(
      log.filter((line) => /^git (commit|push|add)|^gh pr (create|merge)/u.test(line)),
    ).toEqual([]);
    expect(writes).toEqual([]);
    expect(await readFile(body, 'utf-8')).toBe('## Verification\n');
    await runPr([...open, '--unverified', 'host down'], run, write);
    expect(await readFile(body, 'utf-8')).toContain('unverified because: host down');
  } finally {
    process.env.DELIVERY_EVIDENCE_ROOT = evidence;
  }
});

test('the gate comes from clutch.yaml, and a bad value throws', async () => {
  const body = await bodyFile('B\n');
  const options = { base: 'main', bodyFile: body, gate: true };
  const runtime = 'packages/runtime/queue.ts\n';
  await expect(recordVerification(fakeGit('enforced', runtime), '/', options)).rejects.toThrow(
    'verification.gate in clutch.yaml is "enforced"',
  );
  await expect(recordVerification(fakeGit('enforce', runtime), '/', options)).rejects.toThrow(
    'gate blocks',
  );
  // A PR cannot weaken the gate of its base for itself.
  const weaker = fakeGit('off', runtime, [], 'enforce');
  await expect(recordVerification(weaker, '/', options)).rejects.toThrow('gate blocks');
  await recordVerification(fakeGit('off', runtime), '/', options);
  expect(await readFile(body, 'utf-8')).toContain('Verified: incomplete (missing: session-queue)');
  await recordVerification(fakeGit('enforce', runtime), '/', { ...options, gate: false });
});

test('the web flow covers each workspace package that an app depends on', async () => {
  const repo = path.resolve(import.meta.dir, '../..');
  const read = async (file: string) => JSON.parse(await readFile(path.join(repo, file), 'utf-8'));
  const verify = await read('.agents/skills/verify/verification.json');
  const paths: Array<string> = verify.flows['notes-sync'].paths;
  const queue = ['apps/app', 'apps/api'];
  for (const folder of queue) {
    const manifest = await read(`${folder}/package.json`);
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      const dependency = name.startsWith('@repo/') ? `packages/${name.slice(6)}` : '';
      if (dependency && !queue.includes(dependency)) {
        expect(paths).toContain(`${dependency}/**`);
        queue.push(dependency);
      }
    }
  }
});
