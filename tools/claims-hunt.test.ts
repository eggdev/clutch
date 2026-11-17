import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { brokenClaims, huntClaims, newSeed } from '@tools/claims-hunt';
import type { RunProof } from '@tools/claims-hunt';

const scratch: Array<string> = [];

afterAll(async () => {
  await Promise.all(scratch.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** The output of `proveClaims` when `notes/rename` breaks its idempotence. */
const failedOutput = [
  'error: The contract notes breaks its claims (seed 7).',
  'The command notes/rename breaks a claim of its contract:',
  '  idempotent, run 3: a second run of the same input changed the records: it changed ["Note k1"].',
  '    Input: {"id":"k1","title":""}',
  '    12 more runs broke it too.',
  'Run the same inputs again with CLAIMS_SEED=7 CLAIMS_RUNS=400.',
].join('\n');

const notes = 'packages/notes/runtime/contract-claims.test.ts';
const access = 'packages/access/runtime/contract-claims.test.ts';

test('the broken claims are read from the output of a failed proof', () => {
  expect(brokenClaims(failedOutput)).toEqual([{ command: 'notes/rename', claim: 'idempotent' }]);
  expect(brokenClaims('1 pass\n0 fail')).toEqual([]);
});

test('a new seed is a whole number above zero', () => {
  const seed = newSeed();
  expect(Number.isSafeInteger(seed) && seed >= 1 && seed <= 2_147_483_647).toBe(true);
});

test('a broken claim fails the hunt, and names the package, the claim, the seed and the line to run it again', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'claims-hunt-'));
  scratch.push(folder);
  const summary = path.join(folder, 'summary.md');
  const lines: Array<string> = [];
  const seen: Array<string> = [];
  const run: RunProof = (file, seed, runs) => {
    seen.push(`${file} ${seed} ${runs}`);
    const proved = 'The contract access was proved with seed 7 and 400 runs of each command.';
    return { file, passed: file !== notes, output: file === notes ? failedOutput : proved };
  };
  const code = huntClaims(
    [access, notes],
    7,
    400,
    { env: { GITHUB_STEP_SUMMARY: summary }, log: (line) => lines.push(line) },
    run,
  );
  expect(code).toBe(1);
  expect(seen).toEqual([`${access} 7 400`, `${notes} 7 400`]);
  expect(lines[0]).toBe('Seed: 7. Runs of each command: 400.');
  const again = `CLAIMS_SEED=7 CLAIMS_RUNS=400 mise exec -- bun test --timeout 600000 ${notes}`;
  expect(lines).toContain(
    `::error file=${notes},title=Contract claim broken with a new seed::Package notes: notes/rename breaks "idempotent". Run it again: ${again}`,
  );
  const written = await readFile(summary, 'utf-8');
  expect(written).toContain('Seed 7, with 400 runs of each command.');
  expect(written).toContain('- `access`: each claim holds.');
  expect(written).toContain(
    `- \`notes\`: notes/rename breaks "idempotent". Run it again: \`${again}\``,
  );
});

test('a hunt in which each claim holds passes, and still prints the seed', () => {
  const lines: Array<string> = [];
  const code = huntClaims([notes], 11, 5, { env: {}, log: (line) => lines.push(line) }, (file) => ({
    file,
    passed: true,
    output: 'The contract notes was proved with seed 11 and 5 runs of each command.',
  }));
  expect(code).toBe(0);
  expect(lines).toEqual(['Seed: 11. Runs of each command: 5.', `${notes}: each claim holds.`]);
});

test('a proof that passes with another seed or count, or that is skipped, fails the hunt', () => {
  for (const output of [
    '',
    'The contract notes was proved with seed 532 and 5 runs of each command.',
    'The contract notes was proved with seed 11 and 40 runs of each command.',
  ]) {
    const lines: Array<string> = [];
    const code = huntClaims(
      [notes],
      11,
      5,
      { env: {}, log: (line) => lines.push(line) },
      (file) => ({ file, passed: true, output }),
    );
    expect(code).toBe(1);
    expect(lines.at(-1)).toStartWith(
      `::error file=${notes},title=Contract proof did not use the new seed::Package notes: the proof passed, but not with the seed`,
    );
  }
});

test('a proof file that fails with no named claim gets its own title', () => {
  const lines: Array<string> = [];
  const code = huntClaims([notes], 11, 5, { env: {}, log: (line) => lines.push(line) }, (file) => ({
    file,
    passed: false,
    output: 'SyntaxError: Unexpected token',
  }));
  expect(code).toBe(1);
  expect(lines.at(-1)).toStartWith(
    `::error file=${notes},title=Contract proof failed with a new seed::`,
  );
});

test('the real proof of the notes package says the seed and the count that the hunt gave it', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'claims-hunt-'));
  scratch.push(folder);
  const summary = path.join(folder, 'summary.md');
  const lines: Array<string> = [];
  const code = huntClaims([notes], 7, 60, {
    env: { GITHUB_STEP_SUMMARY: summary },
    log: (line) => lines.push(line),
  });
  expect(lines).toEqual(['Seed: 7. Runs of each command: 60.', `${notes}: each claim holds.`]);
  expect(code).toBe(0);
  expect(await readFile(summary, 'utf-8')).toContain('- `notes`: each claim holds.');
});

test('a proof that fails with no broken claim still fails the hunt', () => {
  const lines: Array<string> = [];
  const code = huntClaims([notes], 3, 5, { env: {}, log: (line) => lines.push(line) }, (file) => ({
    file,
    passed: false,
    output: 'SyntaxError: Unexpected token',
  }));
  expect(code).toBe(1);
  expect(lines.at(-1)).toContain('the proof failed and named no broken claim');
});
