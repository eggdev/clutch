import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { checkContract } from '@tools/check-contract';
import { checkDb } from '@tools/check-db';
import { checkJourneys } from '@tools/check-journeys';
import { checkStructure } from '@tools/check-structure';
import { addCommand } from '@tools/generators/command/generator.ts';
import { addFeature } from '@tools/generators/feature/generator.ts';
import { addJob } from '@tools/generators/job/generator.ts';
import { addPackage, parseSections } from '@tools/generators/package/generator.ts';
import { recordGenerator } from '@tools/generators/record/generator.ts';
import { verificationFile } from '@tools/journeys/journeys';

const root = path.resolve(import.meta.dir, '../..');

/** A tree with the files that the generators read from a real workspace. */
async function workspace(): Promise<Tree> {
  const tree = createTreeWithEmptyWorkspace();
  for (const file of [
    'docs/contributing/architecture/primitives.yaml',
    'oxlint.config.ts',
    'apps/app/app/index.tsx',
    'apps/app/package.json',
    'apps/api/package.json',
  ]) {
    tree.write(file, await readFile(path.join(root, file), 'utf-8'));
  }
  tree.write(verificationFile, JSON.stringify({ name: 'acme', flows: {} }));
  for (const name of [
    'effect',
    'react',
    '@types/react',
    'react-native-css',
    'drizzle-orm',
    'drizzle-kit',
  ]) {
    tree.write(`node_modules/${name}/package.json`, JSON.stringify({ version: '1.0.0' }));
  }
  return tree;
}

/**
 * Writes each created or changed source file of the tree into a new folder in
 * `parent`, then runs `check` there. A folder in the repository reads its aliases.
 */
async function inFolder<T>(
  tree: Tree,
  check: (folder: string) => Promise<T> | T,
  parent = tmpdir(),
): Promise<T> {
  await mkdir(parent, { recursive: true });
  const folder = await mkdtemp(path.join(parent, 'generated-'));
  try {
    for (const change of tree.listChanges()) {
      if (change.type !== 'DELETE' && !change.path.startsWith('node_modules/')) {
        await mkdir(path.join(folder, path.dirname(change.path)), { recursive: true });
        await writeFile(path.join(folder, change.path), change.content ?? '');
      }
    }
    return await check(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** Each oxlint diagnostic in the generated source files, as `path rule`, with the real config. */
function lintFolder(folder: string): Array<string> {
  const run = Bun.spawnSync([
    path.join(root, 'node_modules/.bin/oxlint'),
    '-c',
    path.join(root, 'oxlint.config.ts'),
    '--format',
    'json',
    path.join(folder, 'packages'),
    path.join(folder, 'features'),
    path.join(folder, 'apps'),
  ]);
  const result = JSON.parse(run.stdout.toString());
  return result.diagnostics.map(
    (item: { code: string; filename: string }) =>
      `${path.relative(folder, item.filename)} ${item.code}`,
  );
}

/**
 * Typechecks one generated package against the real contract code. The
 * package's files are written into a fresh folder under `.data/`, and the
 * `@repo/*` paths reach the repository's packages, so the generated code
 * meets the real helpers. It lists each `error TS` block of the output, so an
 * empty list means the package compiles.
 */
async function typeErrorsOf(tree: Tree, packageName: string): Promise<Array<string>> {
  // A fresh checkout has no `.data/` yet.
  await mkdir(path.join(root, '.data'), { recursive: true });
  const folder = await mkdtemp(path.join(root, '.data', 'generated-types-'));
  try {
    for (const change of tree.listChanges()) {
      if (change.type !== 'DELETE' && change.path.startsWith(`packages/${packageName}/`)) {
        await mkdir(path.join(folder, path.dirname(change.path)), { recursive: true });
        await writeFile(path.join(folder, change.path), change.content ?? '');
      }
    }
    await writeFile(
      path.join(folder, 'tsconfig.json'),
      JSON.stringify({
        extends: path.join(root, 'tsconfig.base.json'),
        compilerOptions: {
          noEmit: true,
          composite: false,
          emitDeclarationOnly: false,
          declarationMap: false,
          jsx: 'react-jsx',
          lib: ['es2024', 'dom', 'dom.iterable'],
          paths: {
            [`@repo/${packageName}/*`]: [path.join(folder, `packages/${packageName}/*`)],
            '@repo/*': [path.join(root, 'packages/*')],
          },
        },
        include: [`packages/${packageName}/**/*.ts`, `packages/${packageName}/**/*.tsx`],
        exclude: [`packages/${packageName}/**/*.test.ts`, `packages/${packageName}/**/*.test.tsx`],
      }),
    );
    const run = Bun.spawnSync([
      path.join(root, 'node_modules/.bin/tsgo'),
      '-p',
      path.join(folder, 'tsconfig.json'),
      // Plain output: colors would split the `error TS` text that this helper reads.
      '--pretty',
      'false',
    ]);
    return run.stdout
      .toString()
      .split(/\n(?=\S)/u)
      .filter((block) => block.includes('error TS'));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test('a package, a command and a feature pass lint, the structure check and the typecheck', async () => {
  const tree = await workspace();
  addPackage(tree, {
    name: 'billing',
    sections: 'contract,commands,repo,jobs,runtime,ui,testing',
    record: 'invoice',
    group: 'org',
  });
  addCommand(tree, {
    package: 'billing',
    name: 'archive-invoice',
    record: 'invoice',
    waits: 'server',
    access: 'group',
  });
  addCommand(tree, {
    package: 'billing',
    name: 'open-invoice',
    record: 'invoice',
    waits: 'local',
    access: 'organization',
  });
  addJob(tree, { package: 'billing', name: 'send-invoice' });
  addFeature(tree, { name: 'billing' });
  const contract = tree.read('packages/billing/contract/billing.ts', 'utf-8') ?? '';
  expect(contract).toContain(
    "export const archiveInvoice = command('billing/archive-invoice', {\n  input: { id: 'string', at: 'now' },\n  waits: 'server',\n  access: 'group',\n  refuses: [],\n  tool: 'none',\n});",
  );
  expect(contract).toContain('records: [invoiceRecord],');
  expect(contract).toContain('commands: [archiveInvoice, openInvoice],');
  expect(contract).toContain("import { command } from '@repo/sync/contract/command';");
  expect(tree.exists('packages/billing/commands/archive-invoice.server.ts')).toBe(true);
  expect(tree.exists('packages/billing/commands/archive-invoice.ts')).toBe(false);
  expect(tree.exists('packages/billing/commands/open-invoice.ts')).toBe(true);
  expect(tree.read('packages/billing/commands/archive-invoice.server.ts', 'utf-8')).toContain(
    'group: () => Effect.succeed(null),',
  );
  expect(tree.read('packages/billing/commands/open-invoice.server.ts', 'utf-8')).not.toContain(
    'group:',
  );
  expect(tree.read('packages/billing/commands/open-invoice.ts', 'utf-8')).toContain(
    'export const openInvoiceLocal = localChange(openInvoice, (draft, input) => {',
  );
  expect(contract).toContain(
    "export const sendInvoiceJob = job('billing/send-invoice', { payload: {} });",
  );
  expect(contract).toContain('jobs: [sendInvoiceJob],');
  expect(tree.read('packages/billing/jobs/send-invoice.ts', 'utf-8')).toContain(
    'export const sendInvoice = defineJob(sendInvoiceJob, () => Effect.void);',
  );
  // The runtime files list the package. The sync generator writes each app's list, so no app file changes here.
  expect(tree.read('packages/billing/runtime/client.ts', 'utf-8')).toContain(
    'export const billingClient = clientPackage(billingContract, [openInvoiceLocal]);',
  );
  // Each package with a contract proves its claims, so check-contract passes on a new package.
  expect(tree.read('packages/billing/runtime/contract-claims.test.ts', 'utf-8')).toContain(
    'proveClaims(billingClient)',
  );
  const server = tree.read('packages/billing/runtime/server.server.ts', 'utf-8') ?? '';
  expect(server).toContain(
    'export const billingServer = serverPackage(billingContract, {\n  changes: [archiveInvoiceServer, openInvoiceServer],\n  jobs: [sendInvoice],\n  routes: [],\n  migrate: migrateBilling,\n});',
  );
  expect(tree.listChanges().map((change) => change.path)).not.toContain('apps/api/src/packages.ts');
  expect(tree.listChanges().map((change) => change.path)).not.toContain('apps/app/lib/packages.ts');
  expect(tree.read('packages/billing/repo/schema.ts', 'utf-8')).toContain(
    "export const invoiceRecords = pgTable('invoice', {",
  );
  expect(tree.exists('packages/billing/repo/invoice.test.ts')).toBe(true);
  expect(tree.children('packages/billing/repo/migrations')).toEqual(['.gitkeep']);
  expect(tree.read('apps/app/app/billing.tsx', 'utf-8')).toContain(
    "import { BillingScreen } from '@features/billing/screens/billing-screen';",
  );
  expect(tree.read('apps/app/app/billing.tsx', 'utf-8')).toContain(
    'export default function BillingRoute() {',
  );
  expect(
    JSON.parse(tree.read('apps/app/package.json', 'utf-8') ?? '{}').dependencies,
  ).toMatchObject({ '@features/billing': 'workspace:*' });
  expect(tree.read('features/billing/journeys/billing-open.journey.ts', 'utf-8')).toContain(
    "open('/billing'),",
  );
  expect(tree.exists('features/billing/journeys/billing-open.pw.ts')).toBe(false);
  expect(tree.read('oxlint.config.ts', 'utf-8')).toContain(
    "'/billing': { gate: 'features/billing/gate.ts', routes: 'apps/app/app/billing.tsx' }",
  );
  const registry = tree.read('docs/contributing/architecture/primitives.yaml', 'utf-8') ?? '';
  expect(registry).toContain('  - id: billing\n');
  expect(registry).toContain('  - id: billing-feature\n');
  await inFolder(tree, (folder) => {
    expect(lintFolder(folder)).toEqual([]);
    expect(checkStructure(folder)).toEqual([]);
    expect(checkJourneys(folder)).toEqual([]);
  });
  expect(await typeErrorsOf(tree, 'billing')).toEqual([]);
}, 120_000);

test('a package needs contract/ or types/, and names only known sections', () => {
  expect(parseSections('ui,types')).toEqual(['types', 'ui']);
  expect(parseSections('contract,commands')).toEqual(['contract', 'commands']);
  expect(() => parseSections('ui')).toThrow(
    'A package needs `contract/` or `types/`: the section that says what it offers.',
  );
  expect(() => parseSections('types,lib')).toThrow('Unknown sections: lib.');
});

test('a command needs its record in the contract, and a name that is taken fails', async () => {
  const tree = await workspace();
  addPackage(tree, {
    name: 'billing',
    sections: 'contract,commands',
    record: 'invoice',
    group: 'org',
  });
  addPackage(tree, { name: 'drafts', sections: 'contract,commands' });
  expect(() =>
    addCommand(tree, {
      package: 'drafts',
      name: 'pay',
      record: 'invoice',
      waits: 'local',
      access: 'organization',
    }),
  ).toThrow('packages/drafts/contract/drafts.ts does not declare `invoiceRecord`.');
  addCommand(tree, {
    package: 'billing',
    name: 'pay',
    record: 'invoice',
    waits: 'local',
    access: 'organization',
  });
  expect(() =>
    addCommand(tree, {
      package: 'billing',
      name: 'pay',
      record: 'invoice',
      waits: 'local',
      access: 'organization',
    }),
  ).toThrow('packages/billing/contract/billing.ts already declares `pay`.');
  expect(() => addPackage(tree, { name: 'billing', sections: 'types' })).toThrow(
    'packages/billing already exists.',
  );
  expect(() => addFeature(tree, { name: 'notes' })).toThrow(
    'already has the primitive `notes-feature`',
  );
});

test('each package with a contract gets a test that proves its claims, so check-contract passes', async () => {
  const tree = await workspace();
  // Neither package asks for `runtime/`, and each one still gets a client half and a proof.
  addPackage(tree, { name: 'demo-pad', sections: 'contract,commands' });
  addPackage(tree, { name: 'drafts', sections: 'contract' });
  addPackage(tree, { name: 'email', sections: 'types' });
  for (const [name, client] of [
    ['demo-pad', 'demoPadClient'],
    ['drafts', 'draftsClient'],
  ]) {
    expect(tree.exists(`packages/${name}/runtime/client.ts`)).toBe(true);
    const proof = tree.read(`packages/${name}/runtime/contract-claims.test.ts`, 'utf-8') ?? '';
    expect(proof).toContain(`import { ${client} } from '@repo/${name}/runtime/client';`);
    expect(proof).toContain(`proveClaims(${client})`);
  }
  expect(tree.exists('packages/email/runtime')).toBe(false);
  const findings = await inFolder(
    tree,
    (folder) => checkContract(folder, { engineRoot: root, baseCommit: null }),
    path.join(root, '.data'),
  );
  expect(findings.map((finding) => finding.id)).not.toContain('check-contract/claims-not-proven');
});

test('a package owns no record until --record names one, and repo/ needs runtime/ and a record', async () => {
  const tree = await workspace();
  addPackage(tree, { name: 'email', sections: 'types,service,testing' });
  expect(tree.children('packages/email/types')).toEqual(['.gitkeep']);
  expect(tree.children('packages/email/service')).toEqual(['.gitkeep']);
  expect(tree.exists('packages/email/repo')).toBe(false);
  expect(tree.exists('packages/email/contract')).toBe(false);
  expect(() =>
    addPackage(tree, { name: 'ledger', sections: 'contract,repo', record: 'entry', group: 'org' }),
  ).toThrow('A package with `repo/` needs `runtime/`.');
  expect(() => addPackage(tree, { name: 'ledger', sections: 'contract', record: 'entry' })).toThrow(
    'A record needs its sync group.',
  );
  expect(() => addPackage(tree, { name: 'ledger', sections: 'contract,repo,runtime' })).toThrow(
    'Name the first one with `--record=<name>`.',
  );
  expect(() => addPackage(tree, { name: 'ledger', sections: 'types,commands' })).toThrow(
    'A package with `commands/` needs `contract/`',
  );
  expect(() =>
    addPackage(tree, { name: 'ledger', sections: 'types', record: 'entry', group: 'org' }),
  ).toThrow('A record is declared in `contract/`.');
  await inFolder(tree, (folder) => expect(checkStructure(folder)).toEqual([]));
});

test('a record gets a table only in a package with repo/, and only drizzle-kit writes migrations', async () => {
  const tree = await workspace();
  addPackage(tree, {
    name: 'ledger',
    sections: 'contract,repo,runtime',
    record: 'entry',
    group: 'org',
  });
  addPackage(tree, { name: 'drafts', sections: 'contract' });
  recordGenerator(tree, { package: 'ledger', name: 'account', group: 'org' });
  recordGenerator(tree, { package: 'drafts', name: 'draft', group: 'org' });
  expect(tree.read('packages/ledger/repo/schema.ts', 'utf-8')).toContain(
    "export const accountRecords = pgTable('account', {",
  );
  expect(tree.exists('packages/ledger/repo/account.ts')).toBe(true);
  expect(tree.exists('packages/drafts/repo')).toBe(false);
  expect(await typeErrorsOf(tree, 'ledger')).toEqual([]);
  await inFolder(tree, async (folder) => {
    expect(lintFolder(folder)).toEqual([]);
    expect(checkStructure(folder)).toEqual([]);
    await symlink(path.join(root, 'node_modules'), path.join(folder, 'node_modules'));
    const problems = checkDb(folder);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toEndWith(
      'Run `mise exec -- bun nx run @repo/ledger:db-generate`, and commit the migration.',
    );
  });
}, 120_000);
