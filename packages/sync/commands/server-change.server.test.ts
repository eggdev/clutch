import { afterAll, expect, test } from 'bun:test';

import type { ServerChange } from '@repo/sync/commands/server-change.server';
import { serverChange } from '@repo/sync/commands/server-change.server';
import { command } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { defineGroup } from '@repo/sync/contract/groups';
import { record } from '@repo/sync/contract/record';
import { Database } from '@repo/sync/service/database';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { SyncGroups } from '@repo/sync/service/sync-groups';
import { DatabaseTest } from '@repo/sync/testing/database';
import { removeTypeFixtures, typeErrors } from '@repo/sync/testing/type-errors';
import { CommandRejected } from '@repo/sync/types/command-rejected';
import { Effect, Layer } from 'effect';

afterAll(removeTypeFixtures);

const header = `import { command, localChange } from '@repo/sync/contract/command';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { list, oneOf, optional, shape } from '@repo/sync/contract/fields';
import { record } from '@repo/sync/contract/record';
import type { RowOf } from '@repo/sync/contract/record';
import { clientPackage, defineContract } from '@repo/sync/contract/define';
import { serverChange } from '@repo/sync/commands/server-change.server';
import { serverPackage } from '@repo/sync/service/server-package.server';
import { transactionSafe } from '@repo/sync/service/transaction-safe';
import { Context, Effect } from 'effect';

const pay = command('fixture/pay', {
  input: { id: 'new-id', amount: 'number', at: 'now' },
  waits: 'server',
  access: 'organization',
  refuses: ['card-declined'],
  tool: 'none',
});
const move = command('fixture/move', {
  input: { id: 'string' },
  waits: 'local',
  access: 'group',
  refuses: [],
  tool: 'none',
});
const order = record('Order', {
  fields: {
    id: 'string',
    status: oneOf('draft', 'sent'),
    lines: list(shape({ label: 'string', cents: 'integer' })),
    note: optional('string'),
  },
  groups: [organizationGroup.ofScope],
});
export type Order = RowOf<typeof order>;
export const sent: Order = { id: 'o1', status: 'sent', lines: [{ label: 'x', cents: 150 }], note: null };
const fixture = defineContract('fixture', { records: [order], commands: [pay, move], loads: [] });

/** A vendor service: it calls the network, so it has no mark. */
export class Billing extends Context.Service<Billing, { readonly charge: () => Effect.Effect<void> }>()(
  'fixture/Billing',
) {}

/** A service that only writes the transaction it is given, so it has the mark. */
export class Ledger extends Context.Service<
  Ledger,
  { readonly [transactionSafe]: true; readonly record: () => Effect.Effect<void> }
>()('fixture/Ledger') {}

const payServer = serverChange(pay, {
  run: (input, { refuse }) =>
    Effect.gen(function* () {
      yield* (yield* Ledger).record();
      return input.amount > 100 ? yield* refuse('card-declined', 'Declined.') : [];
    }),
});
const moveServer = serverChange(move, {
  group: (input) => Effect.succeed(\`space:\${input.id}\`),
  run: () => Effect.succeed([]),
});
const moveLocal = localChange(move, (_draft, input) => input.id);
export const good = [
  serverPackage(fixture, { changes: [payServer, moveServer] }),
  clientPackage(fixture, [moveLocal]),
];
`;

test('each declaration that the contract makes complete typechecks', async () => {
  expect(await typeErrors(header)).toEqual([]);
}, 30_000);

test('a half that breaks its contract fails the typecheck, and the error names the fix', async () => {
  const errors = await typeErrors(
    `${header}
export const vendor = serverChange(pay, {
  run: () => Effect.gen(function* () { yield* (yield* Billing).charge(); return []; }),
});
export const noGroup = serverChange(move, { run: () => Effect.succeed([]) });
export const wrongCode = serverChange(pay, {
  run: (_input, { refuse }) => Effect.fail(refuse('no-such-code', 'No.')),
});
export const noServerHalf = serverPackage(fixture, { changes: [payServer] });
export const noLocalChange = clientPackage(fixture, []);
export const localOfServerWait = localChange(pay, () => null);
export const noAccess = command('fixture/open', {
  input: {},
  waits: 'server',
  refuses: [],
  tool: 'none',
});
export const badStatus: Order = { id: 'o1', status: 'void', lines: [], note: null };
export const badLine: Order = { id: 'o1', status: 'draft', lines: [{ label: 'x', cents: 'many' }] };
export const otherCommandCode = serverChange(move, {
  group: (input) => Effect.succeed(\`space:\${input.id}\`),
  run: (_input, { refuse }) => Effect.fail(refuse('card-declined', 'No.')),
});
`,
  );
  expect(errors).toHaveLength(10);
  expect(errors[0]).toContain("Property '[transactionSafe]' is missing");
  expect(errors[1]).toContain("Property 'group' is missing");
  expect(errors[2]).toContain(`'"no-such-code"' is not assignable`);
  expect(errors[3]).toContain(`readonly missingHalfOf: "fixture/move"`);
  expect(errors[4]).toContain(`readonly missingHalfOf: "fixture/move"`);
  expect(errors[5]).toContain(`Type '"server"' is not assignable to type '"local"'`);
  expect(errors[6]).toContain("Property 'access' is missing");
  expect(errors[7]).toContain(`'"void"' is not assignable`);
  expect(errors[8]).toContain("Type 'string' is not assignable to type 'number'");
}, 30_000);

const rename = command('cards/rename', {
  input: { id: 'string', title: 'string' },
  waits: 'local',
  access: 'group',
  refuses: ['title-taken'],
  tool: 'none',
});

/** A `SyncGroups` that lets the actor use only the group `space:open`. */
const groups = Layer.succeed(SyncGroups)({
  groupsFor: () => Effect.succeed({ eager: [], lazy: [] }),
  canUse: (_db, _actor, group) => Effect.succeed(group === 'space:open'),
});

const actor = { userId: 'user-test', organizationId: 'org-test' };

/** Runs one input through a server change, and gives its changes or its failure. */
function runChange(change: ReturnType<typeof renameServer>, input: unknown) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      return yield* change.run(input, { db, actor }).pipe(Effect.result);
    }).pipe(Effect.provide(Layer.provideMerge(groups, DatabaseTest()))),
  );
}

function renameServer(code: string) {
  return serverChange(rename, {
    group: (input) => Effect.succeed(input.id === 'gone' ? null : `space:${input.id}`),
    run: (input) =>
      input.title === 'Taken'
        ? Effect.fail(new CommandRejected({ code, reason: 'This title is taken.' }))
        : Effect.succeed([]),
  });
}

test('the door refuses a bad input, a missing record and a group the actor may not use', async () => {
  const change = renameServer('title-taken');
  const [badInput, missing, forbidden, accepted] = await Promise.all([
    runChange(change, { id: 'open', title: 7 }),
    runChange(change, { id: 'gone', title: 'A' }),
    runChange(change, { id: 'closed', title: 'A' }),
    runChange(change, { id: 'open', title: 'A' }),
  ]);
  expect(badInput).toMatchObject({ failure: { _tag: 'CommandRejected', code: 'invalid-input' } });
  expect(missing).toMatchObject({ failure: { _tag: 'CommandRejected', code: 'not-found' } });
  expect(forbidden).toMatchObject({ failure: { _tag: 'CommandRejected', code: 'forbidden' } });
  expect(accepted).toMatchObject({ _tag: 'Success', success: [] });
}, 30_000);

test('a declared refusal reaches the caller, and an undeclared one is a contract error', async () => {
  const declared = await runChange(renameServer('title-taken'), {
    id: 'open',
    title: 'Taken',
  });
  expect(declared).toMatchObject({
    failure: { _tag: 'CommandRejected', code: 'title-taken', reason: 'This title is taken.' },
  });
  const undeclared = await runChange(renameServer('made-up'), { id: 'open', title: 'Taken' });
  expect(undeclared).toMatchObject({
    failure: { _tag: 'UndeclaredRefusal', command: 'cards/rename', code: 'made-up' },
  });
}, 30_000);

const publish = command('cards/publish', {
  input: { id: 'string' },
  waits: 'server',
  access: 'group',
  permission: 'project:publish',
  refuses: [],
  tool: 'none',
});
const publishChange = serverChange(publish, {
  group: (input) => Effect.succeed(`space:${input.id}`),
  run: () => Effect.succeed([]),
});

/** A `SyncGroups` that lets the actor use `space:open`, and allows a permission as `allows` says. */
function groupsAllowing(allows?: boolean) {
  return Layer.succeed(SyncGroups)({
    groupsFor: () => Effect.succeed({ eager: [], lazy: [] }),
    canUse: (_db, _actor, group) => Effect.succeed(group === 'space:open'),
    ...(allows === undefined ? {} : { allows: () => Effect.succeed(allows) }),
  });
}

/** Runs the publish change with the `SyncGroups` given, and gives its changes or its failure. */
function runPublish(layer: Layer.Layer<SyncGroups>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      return yield* publishChange.run({ id: 'open' }, { db, actor }).pipe(Effect.result);
    }).pipe(Effect.provide(Layer.provideMerge(layer, DatabaseTest()))),
  );
}

test('a command with a permission is refused when the groups give no way to check it', async () => {
  expect(await runPublish(groupsAllowing())).toMatchObject({
    failure: {
      _tag: 'CommandRejected',
      code: 'forbidden',
      reason: 'You need the project:publish permission.',
    },
  });
}, 30_000);

test('a command with a permission runs when its role grants the permission, and not when it does not', async () => {
  expect(await runPublish(groupsAllowing(true))).toMatchObject({ _tag: 'Success', success: [] });
  expect(await runPublish(groupsAllowing(false))).toMatchObject({
    failure: { _tag: 'CommandRejected', code: 'forbidden' },
  });
}, 30_000);

const spaceOf = defineGroup('space');
const card = record('Card', {
  fields: { id: 'string', spaceId: 'string', title: 'string' },
  groups: [spaceOf.by('spaceId')],
});
const file = command('cards/file', {
  input: { id: 'string', spaceId: 'string', title: 'string' },
  waits: 'server',
  access: 'group',
  refuses: [],
  tool: 'none',
});
const cards = defineContract('cards', { records: [card], commands: [file], loads: [] });
const fileInput = { id: 'c1', spaceId: 'open', title: 'A' };

/** A group command that checks the group of its space, and returns one card in `changeGroup`. */
function fileServer(changeGroup: string) {
  return serverChange(file, {
    group: (input) => Effect.succeed(spaceOf.of(input.spaceId)),
    run: (input) =>
      Effect.succeed([
        {
          model: 'Card',
          id: input.id,
          action: 'upsert' as const,
          data: { id: input.id, spaceId: input.spaceId, title: input.title },
          groups: [changeGroup],
        },
      ]),
  });
}

/** Runs one input through a server change. It gives the outcome, or the message of a defect. */
function runGuarded(change: ServerChange<SyncGroups>, input: unknown) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      return yield* change.run(input, { db, actor }).pipe(Effect.result);
    }).pipe(
      Effect.provide(Layer.provideMerge(groups, DatabaseTest())),
      Effect.catchDefect((defect) =>
        Effect.succeed(defect instanceof Error ? defect.message : String(defect)),
      ),
    ),
  );
}

test('a group command whose change is in its checked group is accepted', async () => {
  expect(await runGuarded(fileServer('space:open'), fileInput)).toMatchObject({
    _tag: 'Success',
  });
}, 30_000);

test('a group command whose change is in another group is a defect', async () => {
  const message = await runGuarded(fileServer('space:closed'), fileInput);
  expect(message).toContain('The command cards/file checked the group "space:open"');
  expect(message).toContain('its change of Card c1 is in the groups space:closed');
  expect(message).toContain('writes only records of the group it checked');
}, 30_000);

test('a group command with a defect commits nothing', async () => {
  const logged = await Effect.runPromise(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const message = yield* log
        .commit(actor.organizationId, 't1', (db) =>
          fileServer('space:closed').run(fileInput, { db, actor }),
        )
        .pipe(
          Effect.as<string | null>(null),
          Effect.catchDefect((defect) =>
            Effect.succeed(defect instanceof Error ? defect.message : String(defect)),
          ),
        );
      return { message, head: yield* log.head(actor.organizationId) };
    }).pipe(
      Effect.provide(
        Layer.merge(eventLog([cards]), groups).pipe(Layer.provideMerge(DatabaseTest())),
      ),
    ),
  );
  expect(logged.message).toContain('checked the group "space:open"');
  expect(logged.head).toBe(0);
}, 30_000);

const note = command('cards/note', {
  input: { id: 'string' },
  waits: 'server',
  access: 'organization',
  refuses: [],
  tool: 'none',
});
const noteServer = serverChange(note, {
  run: () =>
    Effect.succeed([
      {
        model: 'Card',
        id: 'n1',
        action: 'upsert' as const,
        data: { id: 'n1', spaceId: 'closed', title: 'Note' },
        groups: [spaceOf.of('closed')],
      },
    ]),
});

test('an organization command may write a change of a smaller group of its organization', async () => {
  expect(await runGuarded(noteServer, { id: 'n1' })).toMatchObject({ _tag: 'Success' });
}, 30_000);
