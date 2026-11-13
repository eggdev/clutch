import { afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { claimsFindings } from '@tools/contract-claims';
import { formatFinding } from '@tools/findings';

const scratch: Array<string> = [];

afterAll(async () => {
  await Promise.all(scratch.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A scratch repository with the files given. The rule reads them and runs nothing. */
async function repository(files: Record<string, string>): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'contract-claims-'));
  scratch.push(folder);
  for (const [name, source] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(folder, name)), { recursive: true });
    await writeFile(path.join(folder, name), source);
  }
  return folder;
}

const contract = {
  'packages/demo-pad/contract/demo-pad.ts': 'export const demoPadContract = {};\n',
};

test('the fix names the client of a package in camel case, as valid code', async () => {
  const folder = await repository({
    ...contract,
    'packages/demo-pad/runtime/client.ts': 'export const demoPadClient = {};\n',
  });
  expect(claimsFindings(folder, 'demo-pad', 'demoPadContract').map(formatFinding)).toEqual([
    'packages/demo-pad/: has a contract, and no test calls `proveClaims` on it. Add `runtime/contract-claims.test.ts` that calls `proveClaims(demoPadClient)` from `@repo/sync/testing/claims`.',
  ]);
});

test('a package with no client passes its contract with no local change', async () => {
  const folder = await repository(contract);
  const fix = (name: string | undefined) => claimsFindings(folder, 'demo-pad', name)[0]?.fix;
  expect(fix('padContract')).toBe(
    'Add `runtime/contract-claims.test.ts` that calls `proveClaims({ contract: padContract, localChanges: [] })` from `@repo/sync/testing/claims`.',
  );
  // A default export has no name, so the fix names the contract as the generator does.
  expect(fix('default')).toContain('proveClaims({ contract: demoPadContract, localChanges: [] })');
});

test('a test file at any depth that imports the proof and calls it proves the claims', async () => {
  const folder = await repository({
    ...contract,
    'packages/demo-pad/runtime/deep/claims.test.ts':
      "import { proveClaims } from '@repo/sync/testing/claims';\nproveClaims(demoPadClient);\n",
  });
  expect(claimsFindings(folder, 'demo-pad', 'demoPadContract')).toEqual([]);
  const named = await repository({
    ...contract,
    // It names the function, and imports it from nowhere.
    'packages/demo-pad/runtime/claims.test.ts': 'proveClaims(demoPadClient);\n',
    'packages/demo-pad/node_modules/x/claims.test.ts':
      "import { proveClaims } from '@repo/sync/testing/claims';\nproveClaims(x);\n",
  });
  expect(claimsFindings(named, 'demo-pad', 'demoPadContract').map((item) => item.id)).toEqual([
    'check-contract/claims-not-proven',
  ]);
});
