# Contract

A contract is the one declaration of what a package offers: its records, its
commands and its load functions. The object pool, the server, the manifest
and each tool read it. `packages/sync/contract/` holds the engine. Each
package declares its contract in the `contract/` section of its own folder.

| Question                                             | Answer                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Where does a contract live?                          | `contract/<name>.ts` in its package, built with `defineContract`                                   |
| Which code may import it?                            | Any code. Its files import no Effect, Drizzle or React, and only the other files of its own folder |
| What does a record declare?                          | Its fields, with the kind of each, and its sync groups                                             |
| What does a command declare?                         | Its name, its input, `waits`, `access`, `permission`, `refuses` and `tool`                         |
| What does a load function declare?                   | Its record, its group, and the `tool` that an agent reads it through, or `'none'`                  |
| What does a job declare?                             | Its name and the fields of its payload                                                             |
| What does an HTTP route declare?                     | Its name, its method and path, the fields of its body or `'none'`, and what calls it (`says`)      |
| Where is the code of a command?                      | The local change in `commands/<name>.ts`, the server change in `commands/<name>.server.ts`         |
| What does a build send to the server?                | The digest of its manifest, in each `Pull`                                                         |
| What names a change that strands an installed build? | The snapshot `contract.json`, which `check-contract` holds to the contracts                        |

## Field kinds

A record and a command input name each field with one kind. A record takes
every kind except the stamps. `TypeOf` gives the TypeScript type of a record,
and `CallOf` gives the type of a command input, with each stamp optional.

| Kind                                | Holds                                                   | Manifest text                       |
| ----------------------------------- | ------------------------------------------------------- | ----------------------------------- |
| `'string'`                          | A string                                                | `string`                            |
| `'number'`                          | A finite number                                         | `number`                            |
| `'integer'`                         | A whole number                                          | `integer`                           |
| `'boolean'`                         | `true` or `false`                                       | `boolean`                           |
| `'array'`                           | An array, with any items                                | `array`                             |
| `'object'`                          | A plain object, with any fields                         | `object`                            |
| `'json'`                            | Any JSON value                                          | `json`                              |
| `'string?'`, `'integer?'` and so on | The kind, `null`, or no value                           | `string?`                           |
| `text({ max, min })`                | A string of at least `min` and at most `max` characters | `{ kind: 'string', min, max }`      |
| `oneOf('draft', 'sent')`            | One of the values. Its type is the union of the values  | `{ kind: 'enum', values }`, sorted  |
| `list(kind)`                        | An array whose items each have the kind                 | `{ kind: 'list', of }`              |
| `shape({ ...fields })`              | A plain object with the fields, each with its kind      | `{ kind: 'shape', fields }`, sorted |
| `optional(kind)`                    | The kind, `null`, or no value                           | `{ kind: 'optional', of }`          |
| `'new-id'`                          | A stamp: a new ID                                       | `new-id`                            |
| `'now'`                             | A stamp: the time of the run, as an ISO string          | `now`                               |

A `text` field with no `min` has the minimum 0 in the manifest. So `text({ max: 5 })`
and `text({ max: 5, min: 0 })` give one manifest, and one digest.

`matches` in `packages/sync/contract/fields.ts` checks a value against its
fields, nested kinds too. The object pool uses it before it reads a record or
replays a saved input. The server uses it on each command input.

Two checks hold a written record to its contract. `upsertChange` in
`packages/sync/contract/change.ts` checks a record when a server change builds
it, so the mistake shows where it is made. The event log checks each change
again in `commit`, before any client gets it. A record that does not fit stops
the commit. A record is a closed shape when it leaves the server. Both checks
refuse a key that the record does not declare, such as a column from a spread
of a table row. `packages/sync/service/event-log.test.ts` holds that rule. A
client still takes a record with more fields, so a field that the server adds
stays a two-way change. The [server page](./server.md) lists each rule of the event log.

## Stamps

A stamp is an input field that the caller may leave out. The two stamps are
`new-id` and `now`.

- The object pool fills each stamp that is missing when the command runs.
- The pool saves the filled input with the transaction. A replay reads the
  same ID and the same time.
- A screen passes no ID and no time to a command.

`notes/create` uses both stamps:

```ts
input: { id: 'new-id', spaceId: 'string', title, at: 'now' },
```

## Records and groups

`record()` declares one kind of record. Its TypeScript type comes from its
fields, so no second declaration can drift.

```ts
export const noteRecord = record('Note', {
  fields: {
    id: 'string',
    spaceId: 'string',
    title: 'string',
    createdAt: 'string',
    updatedAt: 'string',
  },
  groups: [spaceGroup.by('spaceId')],
});
export type Note = RowOf<typeof noteRecord>;
```

A record has a string `id`, and it names at least one sync group.

- `defineGroup('space')` in `packages/sync/contract/groups.ts` makes `spaceGroup`. Its `of(id)` gives `space:<id>`.
- Each group made by `defineGroup` has `ofScope`, the group of the organization that owns the record.
- `spaceGroup.by('spaceId')` puts a record in the group of one of its fields.
- `organizationGroup.ofScope` puts a record in the group of its organization.
- `userGroup.by('userId')` puts a record in the group of one user.
- `when(field, values, group)` names the group at a write only if the field has one of the values.
- `unless(field, values, group)` names the group at a write only if the field has none of the values.

A group is chosen as the record is written. The engine of the template does
not tell the clients of a group that a record left it. A client that loaded
the old group keeps its copy until it loads the group again. CL-530 in
`.clutch/issues/` tracks that. A record must name one group at each write, or
the commit stops.

The built-in groups, `organizationGroup` and `userGroup`, live in
`packages/sync/contract/engine-groups.ts`. The engine owns that file. Import
them from there, and import `defineGroup`, `when` and `unless` from `groups.ts`.

```ts
export const draftRecord = record('Draft', {
  fields: { id: 'string', projectId: 'string', status: oneOf('draft', 'sent') },
  groups: [unless('status', ['draft'], spaceGroup.by('projectId'))],
});
```

`load()` declares how a screen asks for the records of one group. Its last
argument says what an agent reads through it:

```ts
export const notesOf = load('notes/of-space', noteRecord, spaceGroup, {
  tool: { says: 'List the notes of a space, by the ID of the space.', fields: ['title'] },
});
```

The name is `<contract>/<name>` in kebab case. The `tool` is `'none'`, or the
words of the read tool and the fields that its list returns. See
[MCP server](./mcp.md#read-tools). A gate calls the load function with
`open.load(notesOf, spaceId)`. See [local-first sync](./local-first-sync.md#load-functions).

## Commands

`command()` declares one command. Each field is required, except `permission`,
and no field has a default.

```ts
export const renameNote = command('notes/rename', {
  input: { id: 'string', title, at: 'now' },
  waits: 'local',
  access: 'group',
  refuses: [],
  tool: {
    does: 'changes',
    idempotent: true,
    closed: true,
    says: 'Change the title of a note. The last title that the server gets stands.',
  },
});
```

`title` is a `text()` field, as in `packages/notes/contract/notes.ts`.

| Field        | Holds                                                                      | Values                                                               |
| ------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `input`      | The fields of the input, with the kind of each                             | Field kinds and stamps                                               |
| `waits`      | Whether the screen shows the change at once                                | `'local'` or `'server'`                                              |
| `access`     | Who may run the command                                                    | `'organization'`, or `'group'` for the group of the record it writes |
| `permission` | The permission that the actor's role must grant, such as `project:publish` | Optional. A string, or no value                                      |
| `refuses`    | The codes its server half may give, beyond the built-in ones               | Kebab-case codes, or `[]`                                            |
| `tool`       | What an agent may call it for                                              | `'none'`, or `{ does, idempotent, closed, says }`                    |

- `does` is `'adds'`, `'changes'` or `'removes'`.
- `idempotent` says that a second call with the same input changes nothing more.
- `closed` says that the tool touches only the product's own data.
- `says` tells the caller what to read before it calls the tool.

A command with a `permission` also needs the actor's role to grant it. The
role is checked on the group of the command, or on the organization when
`access` is `'organization'`. See [authorization](./authorization.md#permissions).

A command has two halves, and both are code. Each half takes its types from the declaration.

- `localChange(command, (draft, input) => ...)` in `commands/<name>.ts`. It
  exists only for a command with `waits: 'local'`. It runs on the object pool.
- `serverChange(command, { group, run })` in `commands/<name>.server.ts`, from
  `packages/sync/commands/server-change.server.ts`. The `group` function exists
  exactly when `access` is `'group'`.

`notes/rename` shows the server half. `run` gets `refuse` from its context. It takes only a code from `refuses` or a built-in one:

```ts
export const renameNoteServer = serverChange(renameNote, {
  group: (input, { db, actor }) =>
    findNote(db, actor.organizationId, input.id).pipe(
      Effect.map((note) => (note ? spaceGroup.of(note.spaceId) : null)),
    ),
  run: (input, { db, actor, refuse }) =>
    Effect.gen(function* () {
      const note = yield* findNote(db, actor.organizationId, input.id);
      if (!note) {
        return yield* refuse('not-found', 'This note does not exist.');
      }
      // ...
    }),
});
```

## Claims

A command makes claims in its declaration: what it `does`, whether it is
`idempotent`, and the limits of each input field. A test proves each claim
that a machine can decide. The claims stay in the contract, and no other file
lists them.

`proveClaims` in `packages/sync/testing/claims.ts` takes the contract and the
local changes of a package, as `runtime/client.ts` holds them. It makes inputs
from the declared fields, runs each command on an object pool, and checks the
claims. Each package calls it from `runtime/contract-claims.test.ts`, under
`bun test`:

```ts
test('each command of the notes contract keeps the claims that the contract makes', () => {
  const report = proveClaims(notesClient);
  expect(report.checked.length).toBeGreaterThanOrEqual(notesClient.contract.commands.length * 2);
});
```

The inputs come from a seeded generator, `seeded` in
`packages/sync/testing/seeded.ts`. The default seed is 532, so each run tries
the same inputs. `CLAIMS_SEED=7 mise exec -- bun test packages/notes` tries
other inputs. A failure names the seed, the claim, the run and the input.

Before each run, the pool holds records of the contract with the IDs `k1`,
`k2` and `k3`. A plain `string` field takes one of those values, so a command
that names a record by its ID finds one. A `text` field takes its shortest
length, its longest length or a length between them.

| Claim                  | Holds when                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A valid input is taken | The pool queues an input that fits each field, and does not refuse it                                                                               |
| Each limit refuses     | The pool refuses an input with one field outside its kind, too long, too short, outside `oneOf` or missing. It changes no record and queues nothing |
| `does: 'adds'`         | A run adds a record, and changes or removes none. Some run must add one                                                                             |
| `does: 'changes'`      | A run removes no record. Some run must change one                                                                                                   |
| `does: 'removes'`      | A run adds no record. Some run must remove one                                                                                                      |
| `idempotent: true`     | The pool takes a second run of the same input, with the stamps of the first run, and the run changes no record                                      |

`does` and `idempotent` are checked on the local change, so only for a
command with `waits: 'local'` and a `tool`. A command for which the proof
can make no valid input fails, such as one with `oneOf()` and no values. So
does a command that claims `does` and never acts on any generated input.
An error that a run throws fails the claim of that run, with the run and the
input. A refused second run fails `idempotent`, as a refused run changes
nothing.

The proof does not check these claims. The report of `proveClaims` lists
each one that a command declares, under `unchecked`:

- `closed`: whether a command reaches an outside service is not visible on the pool.
- `says`: it is words for a reader.
- `refuses`, `access` and `permission`: only the server half decides them.
- `does` and `idempotent` of a command with `waits: 'server'`: it has no local change.

`idempotent: false` promises nothing, so it needs no proof.

`check-contract` fails a package that has a contract and no test file that
imports `@repo/sync/testing/claims` and calls `proveClaims`. It reads the
files on disk and runs no test. The package generator writes
`runtime/contract-claims.test.ts` for each package with a contract. It also
writes `runtime/client.ts`, which the test passes to `proveClaims`. A package
with no client passes `{ contract, localChanges: [] }`.

`clutch sync` ships `claims.ts`, `claim-inputs.ts` and `seeded.ts` to each
project as managed files. The proof runs on the project's own object pool,
so it imports `packages/sync/runtime/pool.ts` and
`packages/sync/testing/pool-state.ts`.
`claims.ts` and `claim-inputs.ts` are guardrail files, as a weaker proof
weakens `check-contract`.

## Registration

Registration is exhaustive. Each package declares its halves in one file per side, and the apps derive their lists from those files.

- `clientPackage(contract, [...])` in the package's `runtime/client.ts` takes the local change of each command that waits `'local'`.
- `serverPackage(contract, { changes, jobs, routes, migrate })` in `runtime/server.server.ts` takes the server change of each command, each job and each route.
- A command with no half does not compile. The error names it with `missingHalfOf`.
- `nx sync` writes `packages` in each app from the packages that have these files. Do not edit the app lists.
- `clientOf(packages)` and `serverOf(packages)` give the parts that each app passes to `loadPool`, `SyncServer` and `JobRunner`.
- `loadPool` and `SyncServer` stop at start when a listed command has no half. `tools/generators/packages/packages.test.ts` tests the sync.

## Jobs and routes

`job()` declares a job, and `route()` declares an HTTP route. Both belong to
the `jobs` and `routes` parts of `defineContract`, and both are in
`packages/sync/contract/`.

```ts
export const countNotesJob = job('notes/count-notes', { payload: { spaceId: 'string' } });
export const importNote = route('notes/import-note', {
  method: 'POST',
  path: '/webhooks/notes',
  body: { eventId: 'string', organizationId: 'string', title },
  says: 'An outside system posts one note to import it, signed with the webhook secret.',
});
```

- A job name and a route name are `<contract>/<name>` in kebab case. A route
  has a `says` that is not empty. `packages/sync/contract/job-route.test.ts` tests these rules.
- `defineJob(declaration, run)` in `jobs/<name>.ts` gives the code. The payload
  type comes from the declaration, and `defineJob` fails a stored payload that
  does not match it.
- `defineRoute(declaration, handle)` in `runtime/routes.server.ts` gives the
  code. `bodyOf(declaration, text)` reads a JSON body from the raw text, so a
  webhook checks its signature first.
- The `jobs` and `routes` lists of `serverPackage` hold the code. A declared job
  or route with no code does not compile, and each mismatch throws when the
  module loads. `packages/sync/service/server-package.server.test.ts` tests them.
- `JobRunner` and `HttpRoutes` stop at start when a contract declares a job or
  a route that their list lacks. `packages/sync/runtime/job-runner.test.ts` and
  `packages/sync/runtime/http-routes.server.test.ts` test them.
- A job and a route are not in the digest. A client sends the digest and never
  calls a job or a route.

## Refusal codes

A server half refuses a transaction with `refuse(code, reason)` from its run
context. The sync server rolls the transaction back and gives the client the
code and the reason.

- The built-in codes are `invalid-input`, `not-found`, `forbidden`,
  `unknown-command` and `failed`. Every command has them.
- A command lists its own codes in `refuses`. `command()` rejects a code that is built-in.
- `refuse` is bound to its command. It takes only a code that the command lists, or a built-in one. The type check proves it in `packages/sync/commands/server-change.server.test.ts`.
- A server change that raises another code makes an `UndeclaredRefusal`. The server logs it, and the client gets `failed`.
- `usePendingCommand(command)` returns `refused.code`, typed from `refuses`.
- A code that this build does not know reads as `failed`.
- `useLastRejection()` gives the last rejection of the whole pool.

The sync server gives the built-in codes. `invalid-input` means the input does
not match its fields. `not-found` means the `group` function found no record.
`forbidden` means the actor may not use the group, or lacks the permission.
`failed` means the server half raised an error twice while the database
answered. A write that met a database that did not answer gets no outcome, so
it stays queued. `packages/sync/service/settle.test.ts` holds both cases.

## Manifest and digest

`manifestOf(contracts)` in `packages/sync/contract/manifest.ts` gives the
manifest. It is sorted plain JSON with every record, command and load function
of the contracts.

- A record lists its groups as text, such as `space:{spaceId}`. A group with a condition adds it, such as `shared:{projectId} unless status is draft|ready`.
- A command lists its `permission`, or `null` when it has none.
- A load function lists its `tool`, or `'none'`.
- A job lists its payload fields. A route lists its method, its path, its body fields or `'none'`, and its `says`.
- The digest is 16 hex characters. It is two 32-bit FNV-1a hashes of the records, commands and loads.
- The same contracts give the same digest, in any order.
- The digest is a name for a build. It is not a security check.
- The client sends the digest in each `Pull`. The server logs a line when the digest differs from its own, and it still syncs.

`contract.json` at the repository root is the committed snapshot. It holds the
manifest and the digest. It also holds `since`, the digest of the base branch
snapshot, and `breaks`, the IDs of the one-way changes that the owner accepted.

`check-contract` (`tools/check-contract.ts`) rejects these problems:

- The snapshot is missing, or it does not match the contracts.
- A package's `contract/` exports two contracts, or one that is not named after the package.
- A file of `contract/` declares a part that the contract of the package does not list.
- A file of `contract/` declares a part, and the package exports no contract.
- An app's `packages` list does not list a contract.
- A one-way change from the base branch is not named under `breaks`.
- A package has a contract, and no test calls `proveClaims` on it.

`mise exec -- bun tools/check-contract.ts --write` writes the snapshot. It
prints each change as two-way or one-way. A one-way change needs
`--write --accept-breaks`, and only after the owner agrees. The merge judge holds that: a pull request whose snapshot names a break waits for the owner's approval, whatever its risk tier. See `blockers` in `tools/github/auto-merge-rules.ts`. A break counts only in the pull request whose diff changes `contract.json`.

## Two-way and one-way changes

`compareManifests` in `packages/sync/contract/compatibility.ts` sorts each difference between two manifests.

A two-way change is safe for an installed build. A one-way change is not.

| Door    | Change                                                                                    | Effect on an installed build                                             |
| ------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Two-way | A record, command or load function is added                                               | It keeps working                                                         |
| Two-way | An optional field is added to a record or a command input                                 | It keeps working                                                         |
| Two-way | A command input field is removed                                                          | The server ignores the field that an old build still sends               |
| Two-way | A command input kind takes each old value, and more                                       | Each write that an old build sends still fits                            |
| Two-way | A command's `waits` or `refuses` changes, or its `tool` changes                           | A code that the build does not know reads as `failed`                    |
| Two-way | A load function loads another record or group, or its tool changes                        | The screen or the agent reads the new records                            |
| One-way | A record or a command is removed                                                          | It still holds the records, or it still sends the writes                 |
| One-way | A required field is added to a record or a command input                                  | A saved record or queued write without it reads as missing or is refused |
| One-way | A record field is removed, or its kind changes                                            | A saved value of the old kind reads as missing                           |
| One-way | A record moves to other sync groups, or a group condition changes                         | Other clients get it                                                     |
| One-way | The `access` or the `permission` of a command changes                                     | Queued writes may be refused                                             |
| One-way | A command or a load function stops being a tool, so `tool` becomes `'none'`               | An agent that calls it fails                                             |
| Two-way | A job is added                                                                            | It keeps working                                                         |
| One-way | A job is removed                                                                          | A queued job of that name cannot run                                     |
| One-way | A job payload field is added as required, removed, or narrowed                            | A queued job holds the old payload                                       |
| Two-way | A job payload field is added as optional, or widened                                      | A queued job still fits                                                  |
| Two-way | A route is added                                                                          | It keeps working                                                         |
| One-way | A route is removed, or its method or path changes                                         | An outside system that calls it fails                                    |
| One-way | A route body gains a required field, loses a field, narrows one, or starts to read a body | A request that an outside system sends with the old body is refused      |
| Two-way | A route body gains an optional field, widens one, or stops reading a body                 | A request that an outside system sends still fits                        |
| Two-way | A route's `says` changes                                                                  | It keeps working                                                         |

A command input kind widens when each old value still fits the new kind. A
longer `max`, a shorter `min` and more values in `oneOf` all widen. So do
`integer` to `number`, a kind to its `optional` form and any kind to `json`. A `list` or a
`shape` widens when its parts widen, and a shape gains only optional fields.
Any other change of an input kind narrows it, and it is one-way.

## Change a contract

1. Edit the contract in `contract/<name>.ts`: a field, a group, a command or a load function.
2. Write the local change and the server change of each command that changed. A new record starts with `mise exec -- bun nx g @tools/generators:record <package> <name> --group=<group>`. A new command starts with `mise exec -- bun nx g @tools/generators:command <package> <name> --record=<record> --waits=local --access=group`. That generator declares the command in the contract and writes both halves.
3. Run `mise exec -- bun tools/check-contract.ts --write`. Read each change it prints. For a one-way change, keep the old shape, or add the new one beside it. Use `--accept-breaks` only when the owner agrees.
4. Read the diff of `contract.json`.
5. Commit the contract, the halves and the snapshot in one change.

## A project from before contracts

A project can still hold `models/` folders and the `defineModel` helpers.
`check-structure` rejects each such folder, so the project moves every package
in one branch. The
[move-to-contracts skill](../../../.agents/skills/move-to-contracts/SKILL.md)
has the steps. The template keeps no code for the older form.

## Rules

- A package has at most one contract, in `contract/<name>.ts`, and it is named after the package. `check-contract` rejects a package that breaks this, and `tools/check-contract.test.ts` tests it.
- Each record, command, load function, job and route that a file of `contract/` declares is in that contract. `check-contract` rejects a part that is in none.
- A file of `contract/` may hold plain values, such as a limit. A folder with only such files needs no contract.
- The files of `packages/sync/contract/` import only other files of that folder. `packages/sync/contract/contract.test.ts` tests it, and the built-in groups stay in `engine-groups.ts`.
- A command name is `<contract>/<command>` in kebab case. `packages/sync/contract/contract.test.ts` tests a bad name.
- A load function name is `<contract>/<name>` in kebab case. A load function with no `tool` declaration does not compile.
- A record name is Pascal case, and a record names at least one sync group. `packages/sync/contract/contract.test.ts` tests both.
- A contract declares each name once, and each load function loads a record that the contract declares. `packages/sync/contract/contract.test.ts` tests a repeated name and a stray load.
- Each command with `waits: 'local'` has one local change, and no other command has one. `packages/sync/contract/contract.test.ts` tests the local changes of a contract.
- A server change refuses only with a code that its command lists, or a built-in code. `packages/sync/commands/server-change.server.test.ts` tests a declared and an undeclared code.
- The server rejects an input that does not match its fields with `invalid-input`. `packages/sync/commands/server-change.server.test.ts` tests a bad input.
- A server half with `access: 'group'` must have a `group` function, and one without it does not compile. `packages/sync/commands/server-change.server.test.ts` tests it through the typecheck.
- Each claim of a command that a machine can decide holds on generated inputs. `packages/sync/testing/claims.test.ts` tests the proof, and `tools/check-contract.test.ts` tests that each package calls it.
- The digest changes with any change to the contracts. `packages/sync/contract/manifest.test.ts` tests the digest.
- A job or a route does not change the digest. `packages/sync/contract/job-route.test.ts` tests it.
- A job or route change is sorted two-way or one-way by `compareManifests`. `packages/sync/contract/job-route.test.ts` tests each rule, and `tools/check-contract.test.ts` tests a changed payload.
- Two contracts that declare one name fail the manifest. `packages/sync/contract/manifest.test.ts` tests it.
- A one-way change passes `check-contract` only when `contract.json` names it under `breaks`. `tools/check-contract.test.ts` tests it.
- Client code reads no clock and makes no ID. The lint rule `repo-determinism/no-ambient-time` rejects `Date.now()`, `new Date()` with no argument, `Math.random()` and `crypto.randomUUID()` in client code outside `packages/sync`.

## What to read when changing it

- `packages/sync/contract/fields.ts`, `command.ts`, `define.ts`, `record.ts` and `groups.ts`
- `packages/sync/contract/compatibility.ts` before a change that could strand an installed build
- `tools/check-contract.ts`, and `contract.json` at the repository root
- `packages/notes/contract/notes.ts` as the example package
- [Local-first sync](./local-first-sync.md) and [authorization](./authorization.md)
