import { afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../../..');
const folders: Array<string> = [];

afterAll(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

/**
 * Typechecks one source file against the real `defineServerChange` and lists
 * the output of each error. The file sits in `.data/`, so it reads the
 * repository's aliases and never reaches a commit.
 */
async function typeErrors(source: string): Promise<Array<string>> {
  // A fresh checkout has no `.data/` yet.
  await mkdir(path.join(root, '.data'), { recursive: true });
  const folder = await mkdtemp(path.join(root, '.data', 'type-test-'));
  folders.push(folder);
  await writeFile(path.join(folder, 'fixture.ts'), source);
  await writeFile(
    path.join(folder, 'tsconfig.json'),
    JSON.stringify({
      extends: path.join(root, 'tsconfig.base.json'),
      compilerOptions: {
        noEmit: true,
        composite: false,
        emitDeclarationOnly: false,
        declarationMap: false,
      },
      files: ['fixture.ts'],
    }),
  );
  const run = Bun.spawnSync([
    path.join(root, 'node_modules/.bin/tsgo'),
    '-p',
    path.join(folder, 'tsconfig.json'),
    // Plain output: a terminal or a task runner can turn on colors, which
    // split the `error TS` text that this helper reads.
    '--pretty',
    'false',
  ]);
  return run.stdout
    .toString()
    .split(/\n(?=\S)/u)
    .filter((block) => block.includes('error TS'));
}

const header = `import { defineCommand } from '@repo/sync/commands/define';
import { defineServerChange } from '@repo/sync/commands/define.server';
import { transactionSafe } from '@repo/sync/service/transaction-safe';
import { Context, Effect, Schema } from 'effect';

const pay = defineCommand<{ readonly id: string }>({ name: 'fixture/pay', waits: 'server' });
const Input = Schema.Struct({ id: Schema.String });

/** A vendor service: it calls the network, so it has no mark. */
export class Billing extends Context.Service<Billing, { readonly charge: () => Effect.Effect<void> }>()(
  'fixture/Billing',
) {}

/** A service that only writes the transaction it is given, so it has the mark. */
export class Ledger extends Context.Service<
  Ledger,
  { readonly [transactionSafe]: true; readonly record: () => Effect.Effect<void> }
>()('fixture/Ledger') {}
`;

test('a server change with a vendor service or with no access rule fails the typecheck', async () => {
  const errors = await typeErrors(
    `${header}
export const vendor = defineServerChange(pay, {
  input: Input,
  access: 'organization',
  run: () => Effect.gen(function* () { yield* (yield* Billing).charge(); return []; }),
});
export const noAccess = defineServerChange(pay, {
  input: Input,
  run: () => Effect.succeed([]),
});
`,
  );
  // One error on the vendor change, one on the change with no `access`.
  expect(errors).toHaveLength(2);
  expect(errors[0]).toContain("Property '[transactionSafe]' is missing");
  expect(errors[1]).toContain("Property 'access' is missing");
}, 30_000);

test('a server change with a transaction-safe service and an access rule typechecks', async () => {
  expect(
    await typeErrors(
      `${header}
export const ledger = defineServerChange(pay, {
  input: Input,
  access: { group: (input) => Effect.succeed(\`space:\${input.id}\`) },
  run: () => Effect.gen(function* () { yield* (yield* Ledger).record(); return []; }),
});
`,
    ),
  ).toEqual([]);
}, 30_000);
