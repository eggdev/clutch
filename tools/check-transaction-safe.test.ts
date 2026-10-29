import { expect, test } from 'bun:test';

import { checkTransactionSafe } from '@tools/check-transaction-safe';
import { registryFile } from '@tools/lint/import-policy.mjs';
import { inRepo } from '@tools/testing/in-repo';
import { stringify } from 'yaml';

const registry = (sync: Array<string>, billing: Array<string> = []) =>
  stringify({
    primitives: [
      { id: 'sync', kind: 'package', code: ['packages/sync/'], transactionSafe: sync },
      { id: 'billing', kind: 'package', code: ['packages/billing/'], transactionSafe: billing },
    ],
  });

/** A service class whose shape has the mark when `marked` is true. */
const service = (name: string, key: string, marked: boolean) =>
  `export class ${name} extends Context.Service<\n  ${name},\n  { ${marked ? 'readonly [transactionSafe]: true; ' : ''}readonly run: () => void }\n>()('${key}') {}\n`;

test('a service that marks itself transaction-safe fails until the registry lists it', async () => {
  const files = {
    'packages/sync/service/jobs.ts': service('Outbox', 'sync/Outbox', true),
    'packages/billing/service/stripe.ts': service('Stripe', 'billing/Stripe', true),
    'packages/billing/service/shape.ts':
      'type Shape = { readonly [transactionSafe]: true };\nexport type { Shape };\n',
    'packages/billing/service/plain.ts': service('Plain', 'billing/Plain', false),
    'packages/billing/service/stripe.test.ts': service('Fixture', 'fixture/Ledger', true),
  };
  expect(
    await inRepo({ [registryFile]: registry(['sync/Outbox']), ...files }, checkTransactionSafe),
  ).toEqual([
    `packages/billing/service/shape.ts: it uses the transaction-safe mark outside a Context.Service shape. Put the mark in the service shape, and list the service key in ${registryFile}.`,
    `packages/billing/service/stripe.ts: \`billing/Stripe\` marks itself transaction-safe, but ${registryFile} does not list it under \`transactionSafe\` of its package. Add it there for a person to review, or remove the mark and call the service from a job.`,
  ]);
});

test('a listed service passes, and a listed key with no marked service fails', async () => {
  expect(
    await inRepo(
      {
        [registryFile]: registry(['sync/Outbox', 'sync/Gone'], ['billing/Stripe']),
        'packages/sync/service/jobs.ts': service('Outbox', 'sync/Outbox', true),
        'packages/billing/service/stripe.ts': service('Stripe', 'billing/Stripe', true),
      },
      checkTransactionSafe,
    ),
  ).toEqual([
    `${registryFile}: primitive \`sync\` lists \`sync/Gone\` as transaction-safe, but no service shape with that key has the mark. Delete the entry.`,
  ]);
});
