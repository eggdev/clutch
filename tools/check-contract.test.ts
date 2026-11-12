import { afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ManifestChange } from '@repo/sync/contract/change-doors';
import type { Manifest } from '@repo/sync/contract/manifest';
import { checkContract, snapshotProblems, writeSnapshot } from '@tools/check-contract';
import type { Snapshot } from '@tools/check-contract';

const root = path.resolve(import.meta.dir, '..');
const scratch: Array<string> = [];

afterAll(async () => {
  await Promise.all(scratch.map((folder) => rm(folder, { recursive: true, force: true })));
});

/**
 * A scratch repository inside `.data/`, so its contract files read the
 * repository's aliases and the real contract engine. Each one gets its own
 * folder, because a module loads once for each path.
 */
async function repository(files: Record<string, string>): Promise<string> {
  await mkdir(path.join(root, '.data'), { recursive: true });
  const folder = await mkdtemp(path.join(root, '.data', 'contract-check-'));
  scratch.push(folder);
  for (const [name, source] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(folder, name)), { recursive: true });
    await writeFile(path.join(folder, name), source);
  }
  return folder;
}

const here = { engineRoot: root, baseCommit: null };

const billing = (contract: string, command = `${contract}/pay`) => `
import { command } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';

export const pay = command('${command}', {
  input: { id: 'string' },
  waits: 'server',
  access: 'organization',
  refuses: [],
  tool: 'none',
});
export const billingContract = defineContract('${contract}', {
  records: [],
  commands: [pay],
  loads: [],
});
`;

test('a repository with no contract engine has nothing to check', async () => {
  const folder = await repository({ 'packages/billing/contract/billing.ts': billing('billing') });
  expect(await checkContract(folder)).toEqual([]);
});

test('a repository with the engine and no contract yet passes without a snapshot', async () => {
  const folder = await repository({ 'packages/billing/models/invoice.ts': '' });
  expect(await checkContract(folder, here)).toEqual([]);
});

test('the snapshot is written from the contracts, and then the check passes', async () => {
  const folder = await repository({ 'packages/billing/contract/billing.ts': billing('billing') });
  expect(await checkContract(folder, here)).toEqual([
    'contract.json: is missing. Run `mise exec -- bun tools/check-contract.ts --write`, and commit it.',
  ]);
  expect(await writeSnapshot(folder, false, here)).toEqual([]);
  const written = JSON.parse(await readFile(path.join(folder, 'contract.json'), 'utf-8'));
  expect(written.commands.map((entry: { name: string }) => entry.name)).toEqual(['billing/pay']);
  expect(written.breaks).toEqual([]);
  expect(await checkContract(folder, here)).toEqual([]);
});

/** A billing contract with one job and one route, whose job payload has the field `amount` of the kind given. */
const withJob = (amount: string) => `
import { defineContract } from '@repo/sync/contract/define';
import { job } from '@repo/sync/contract/job';
import { route } from '@repo/sync/contract/route';

export const sendInvoice = job('billing/send-invoice', { payload: { amount: '${amount}' } });
export const receivePayment = route('billing/receive-payment', {
  method: 'POST',
  path: '/webhooks/payments',
  body: 'none',
  says: 'The payment provider posts each payment that it takes.',
});
export const billingContract = defineContract('billing', {
  records: [],
  commands: [],
  loads: [],
  jobs: [sendInvoice],
  routes: [receivePayment],
});
`;

test('a job and a route of a contract are written to the snapshot, and a changed payload is refused', async () => {
  const folder = await repository({ 'packages/billing/contract/billing.ts': withJob('integer') });
  expect(await writeSnapshot(folder, false, here)).toEqual([]);
  const written = JSON.parse(await readFile(path.join(folder, 'contract.json'), 'utf-8'));
  expect(written.jobs).toEqual([
    {
      name: 'billing/send-invoice',
      contract: 'billing',
      payload: { amount: 'integer' },
    },
  ]);
  expect(written.routes.map((entry: { name: string }) => entry.name)).toEqual([
    'billing/receive-payment',
  ]);
  expect(await checkContract(folder, here)).toEqual([]);
  // A module loads once per path, so the changed payload goes in a repository of its own.
  const changed = await repository({
    'packages/billing/contract/billing.ts': withJob('string'),
    'contract.json': await readFile(path.join(folder, 'contract.json'), 'utf-8'),
  });
  expect(await checkContract(changed, here)).toEqual([
    'contract.json: does not match the contracts. Run `mise exec -- bun tools/check-contract.ts --write`, read the diff, and commit it.',
  ]);
});

test('a contract folder of plain values declares nothing, so it needs no contract', async () => {
  const plain = await repository({
    'packages/billing/contract/limits.ts': 'export const limit = 5;\n',
  });
  expect(await checkContract(plain, here)).toEqual([]);
});

test('each declared part is in the one contract of its package', async () => {
  const loose = `
import { command } from '@repo/sync/contract/command';

export const refund = command('billing/refund', {
  input: { id: 'string' },
  waits: 'server',
  access: 'organization',
  refuses: [],
  tool: 'none',
});
`;
  const none = await repository({ 'packages/billing/contract/refund.ts': loose });
  expect(await checkContract(none, here)).toEqual([
    "packages/billing/contract/: declares the command `billing/refund` and exports no contract. Export `defineContract('billing', ...)` from `contract/billing.ts`, and add it to `commands`.",
  ]);
  const unlisted = await repository({
    'packages/billing/contract/billing.ts': billing('billing'),
    'packages/billing/contract/refund.ts': loose,
  });
  expect(await checkContract(unlisted, here)).toEqual([
    'packages/billing/contract/: the command `billing/refund` is not in the contract. Add it to `commands`.',
  ]);
  const misnamed = await repository({
    'packages/billing/contract/billing.ts': billing('payments'),
  });
  expect(await checkContract(misnamed, here)).toEqual([
    'packages/billing/contract/: the contract is named `payments`. Name it `billing`, after its package, so each command name starts with the package.',
  ]);
});

test('one run reports the problems of each package and of each app', async () => {
  const broken = `
import { command } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';

const pay = command('other/pay', {
  input: {},
  waits: 'server',
  access: 'organization',
  refuses: [],
  tool: 'none',
});
export const ledgerContract = defineContract('ledger', {
  records: [],
  commands: [pay, pay],
  loads: [],
});
`;
  const folder = await repository({
    'packages/ledger/contract/ledger.ts': broken,
    'packages/billing/contract/billing.ts': billing('payments'),
    'apps/web/src/packages.ts': 'export const packages = [];\n',
    // A real app list imports each package, so the broken one stops it as it loads.
    'apps/api/src/packages.ts':
      "import { ledgerContract } from '../../../packages/ledger/contract/ledger';\nexport const packages = [{ contract: ledgerContract }];\n",
  });
  expect(await checkContract(folder, here)).toEqual([
    'packages/billing/contract/: the contract is named `payments`. Name it `billing`, after its package, so each command name starts with the package.',
    'packages/ledger/contract/ledger.ts: The command other/pay is in the contract ledger, so its name starts with `ledger/`.',
    'packages/ledger/contract/ledger.ts: The contract ledger declares other/pay twice. Each name is declared once.',
    'apps/api/src/packages.ts: did not load, so its lists are not checked. The command other/pay is in the contract ledger, so its name starts with `ledger/`.',
    "apps/web/src/packages.ts: `packages` does not list the contract `payments`. Run `nx sync`, which writes the list from each package's runtime/client.ts or runtime/server.server.ts.",
  ]);
});

test('an app that lists packages lists each contract', async () => {
  const folder = await repository({
    'packages/billing/contract/billing.ts': billing('billing'),
    'apps/web/src/packages.ts': 'export const packages = [];\n',
    // A native app keeps its list in `lib/`.
    'apps/app/lib/packages.ts': 'export const packages = [];\n',
  });
  await writeSnapshot(folder, false, here);
  expect(await checkContract(folder, here)).toEqual([
    "apps/app/lib/packages.ts: `packages` does not list the contract `billing`. Run `nx sync`, which writes the list from each package's runtime/client.ts or runtime/server.server.ts.",
    "apps/web/src/packages.ts: `packages` does not list the contract `billing`. Run `nx sync`, which writes the list from each package's runtime/client.ts or runtime/server.server.ts.",
  ]);
});

test('an app list with no `packages` fails, and a file that lists no package is not an app list', async () => {
  const folder = await repository({
    'packages/billing/contract/billing.ts': billing('billing'),
    'apps/api/src/packages.ts': 'export const serverChanges = [];\n',
    // The command list of a command-line app: it lists no package.
    'apps/cli/src/commands.ts': 'export const commands = [];\n',
  });
  await writeSnapshot(folder, false, here);
  expect(await checkContract(folder, here)).toEqual([
    'apps/api/src/packages.ts: exports no `packages` list. Run `nx sync`, which writes it.',
  ]);
});

const manifest = (digest: string, commands: Array<string>): Manifest => ({
  version: 1,
  digest,
  records: [],
  commands: commands.map((name) => ({
    name,
    contract: 'notes',
    input: {},
    waits: 'server',
    access: 'organization',
    permission: null,
    refuses: [],
    tool: 'none',
  })),
  loads: [],
  jobs: [],
  routes: [],
});
const snapshot = (from: Manifest, since: string | null, breaks: Array<string> = []): Snapshot => ({
  ...from,
  since,
  breaks,
});
const removed: ManifestChange = {
  id: 'command-removed:notes/archive',
  door: 'one-way',
  says: 'notes/archive is gone.',
};
const added: ManifestChange = {
  id: 'command-added:notes/pin',
  door: 'two-way',
  says: 'notes/pin is a new command.',
};

test('a snapshot that does not match the contracts fails', () => {
  const now = manifest('bbbb', ['notes/pin']);
  expect(snapshotProblems(now, snapshot(manifest('aaaa', []), null), null, [])).toEqual([
    'contract.json: does not match the contracts. Run `mise exec -- bun tools/check-contract.ts --write`, read the diff, and commit it.',
  ]);
  expect(snapshotProblems(now, snapshot(now, null), null, [])).toEqual([]);
});

test('a two-way change from the base passes with no break named', () => {
  const base = manifest('aaaa', []);
  const now = manifest('bbbb', ['notes/pin']);
  expect(snapshotProblems(now, snapshot(now, 'aaaa'), base, [added])).toEqual([]);
});

test('a one-way change passes only when the snapshot names it', () => {
  const base = manifest('aaaa', ['notes/archive']);
  const now = manifest('bbbb', []);
  expect(snapshotProblems(now, snapshot(now, 'aaaa'), base, [removed])).toEqual([
    'contract.json: this change is a one-way door for installed builds. See docs/principles/two-way-doors.md.',
    '  command-removed:notes/archive: notes/archive is gone.',
    '  Keep the old shape, or add the new one beside it. When the owner agreed to the break, run `mise exec -- bun tools/check-contract.ts --write --accept-breaks`.',
  ]);
  expect(snapshotProblems(now, snapshot(now, 'aaaa', [removed.id]), base, [removed])).toEqual([]);
});

test('a break that the change from the base no longer makes fails, and so does another base', () => {
  const base = manifest('aaaa', []);
  const now = manifest('bbbb', ['notes/pin']);
  const stale = [
    'contract.json: `since` and `breaks` do not describe the change from the base branch. Run `mise exec -- bun tools/check-contract.ts --write`.',
  ];
  expect(snapshotProblems(now, snapshot(now, 'aaaa', [removed.id]), base, [added])).toEqual(stale);
  expect(snapshotProblems(now, snapshot(now, 'cccc'), base, [added])).toEqual(stale);
});

test('a snapshot with the manifest of the base says nothing about breaks', () => {
  const same = manifest('aaaa', ['notes/pin']);
  expect(snapshotProblems(same, snapshot(same, 'old', [removed.id]), same, [])).toEqual([]);
});

test('this repository passes its own contract check', async () => {
  expect(await checkContract(root, { baseCommit: null })).toEqual([]);
});
