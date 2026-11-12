---
name: move-to-contracts
description: Move a project whose packages have `models/` folders and declare records and commands with `defineModel`, `defineCommand`, `defineServerChange` and `defineLoad` onto contracts, in one branch. Use it after a Clutch sync brings `packages/sync/contract/`, or when `check-structure` rejects a `models/` folder. It keeps the project's own sync engine.
---

# Move a project to contracts

Inputs: a project that took the Clutch sync with `packages/sync/contract/`, and
its packages that still have `models/`. Output: each package has one contract,
no `models/` folder is left, and `contract.json` is committed.

A contract is the one declaration of what a package offers: its records, its
commands, its load functions, its jobs and its routes. The files in
`packages/sync/contract/` are the vocabulary. Read the doc comment of each
builder before you use it.

Clutch keeps no code for the older form. `check-structure` rejects each
`models/` folder, and lint rejects each import of one. So the whole project
moves in one branch, one commit for each package, and the branch passes
`validate` only at its end. Until then, the proof of a commit is the type
checker, the tests of the package and `check-contract`.

## What the sync brings, and what stays yours

| Path                                      | Rule                                                     |
| ----------------------------------------- | -------------------------------------------------------- |
| `packages/sync/contract/`                 | Managed. It imports nothing outside its own folder.      |
| `packages/sync/contract/engine-groups.ts` | Yours after the sync adds it once.                       |
| The rest of `packages/sync/`              | Yours. Sync never replaces your sync engine.             |
| `tools/check-contract.ts`                 | Managed. It passes while no package declares a contract. |

The vocabulary declares. Your engine runs. So a project writes a small layer
of engine code once, before its first package moves. The Clutch engine is the
reference for that layer:

- [The server half](https://github.com/eggdev/clutch/blob/main/packages/sync/commands/server-change.server.ts)
- [The object pool](https://github.com/eggdev/clutch/blob/main/packages/sync/runtime/pool.ts)
- [The sync server](https://github.com/eggdev/clutch/blob/main/packages/sync/runtime/server.server.ts)
- [The agent tools](https://github.com/eggdev/clutch/blob/main/packages/sync/runtime/tools.server.ts)
- [The React hooks](https://github.com/eggdev/clutch/blob/main/packages/sync/ui/sync-provider.tsx)

## Step 1: take the sync on the branch

1. Run the sync. Answer each keep-or-take decision with the owner.
2. Open `packages/sync/contract/engine-groups.ts`. The file arrives with the
   prefixes `org` and `user`. Compare them with the groups that your older
   `organizationGroup` and `userGroup` helpers return, and set each prefix to
   match. Do this before the first package moves: a wrong prefix hides every
   record of that group from every client.
3. Client code may not read the clock or make an ID: the
   `repo-determinism/no-ambient-time` rule rejects it. A call that fed a
   command leaves in step 3. For a call that stays for another reason, the
   project may ratchet the rule:

   ```sh
   mise exec -- bun run clutch ratchet add no-ambient-time \
     --command 'bun tools/lint/lint-counts.ts repo-determinism/no-ambient-time' \
     --files '{apps,features,packages}/**/*.{ts,tsx}'
   ```

### When the project keeps its own copy of a managed file

Sync stops at each managed file that the project edited, and the owner keeps
or takes it. A kept copy lacks what Clutch added, so port these parts by hand:

| Kept file                    | Port from the Clutch copy                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `oxlint.config.ts`           | The `repo-determinism` plugin, its rule, and its file in the list that may have a default export. `contract/` in each list that named `models/`. `**/*.journey.ts` beside `**/*.pw.ts` |
| `knip.jsonc`                 | `contract/*.ts` in the entry of `packages/*`, and `journeys/*.journey.ts` in the entry of each feature                                                                                     |
| `tools/guardrail-files.json` | `contract.json`, `packages/sync/contract/**`, and the app files that list contracts. `check-guardrail-coverage` names each one that is missing                                         |
| `.github/workflows/ci.yml`   | The step that runs each browser test                                                                                                                                                       |
| `nx.json`                    | `@tools/generators:packages` under `sync.globalGenerators`. It replaces a list generator of your own, which you delete |
| A generator in `tools/`      | A kept `command`, `job` or `package` generator still writes the older form. Take the Clutch copy before the first package moves, and port the project's edits onto it                      |

## Step 2: write the engine layer, once

Each part is a thin function in your own `packages/sync`. Port it from the
reference, and keep the access rules that your engine already has. A trial on
one project needed about 200 lines for parts 1 to 3.

1. **The server half.** A function takes a command declaration and the code
   of its server half, and returns what your sync server runs.
   - It checks the raw input with `matches(declared.input, raw)`.
   - It builds the access rule from the declaration, and checks it through the
     one access door of your engine. Export that door if it is private.
   - `access: 'group'` needs the group of the record. The declaration cannot
     name it, so the server half gives a `group` function. A rule that your
     engine has and the vocabulary lacks stays in the server half too.
   - `access: 'organization'` is the group of the organization. With
     `permission`, the role of the actor must grant it on that group.
   - Add an optional `code` to your rejection error. The access door sets
     `forbidden` and `not-found`. Any other code is one that
     `declared.refuses` names, and an undeclared code is a defect.
   - Give the code of the server half a `refuse(code, reason)` that is bound
     to its command, so it cannot refuse with the code of another command.
   - For `access: 'group'`, check each change that the code returns: it names
     the group that was authorized, or the write stops.
2. **The two modules of a package.** `clientPackage` in
   `packages/sync/contract/define.ts` binds a contract to its local changes.
   Write the server twin in your engine: one function that binds a contract
   to its server halves, jobs, routes and migration. It fails when a declared
   part has no code, and `checkHalves` in `packages/sync/contract/halves.ts`
   compares the names.
3. **The object pool.** Give the pool an entry point that runs a declared
   command. It fills the stamps with `stamped(declared.input, input, stamps)`
   before it saves or sends the command. The stamps are the clock and the
   random ID of the pool, so only the pool reads them.
   - `localChange` returns a name and a `replay` function, with no `waits`. A
     contract lists a local change only for a command that shows at once. So
     let your older type take a missing `waits`, and read it as local.
   - Add one React hook that runs a declared command, and one for a command
     that waits for the server.
   - A load function of a contract has no `model` key. Let your load hooks
     take one without it.
   - Pass the records and commands of every contract to `createPool`. The
     pool has no check without them, so the call needs them.
   - Check a copy at each door of the pool, and nowhere else: the saved copy
     as the pool loads it, a record of a delta, and the input of a command.
     Drop a saved copy that does not fit, refuse a saved command that does not
     fit with `invalid-input`, and report each one.
4. **The wire.** Add `code` to the outcome of a transaction, and `contract` to
   the first message of a client, each as an optional key. An installed build
   sends neither, so it keeps working. Until this part exists, a screen cannot
   branch on a refusal code.
5. **The apps.** Each app has one list, `packages`, in `packages.ts` under
   `src/` or `lib/`. No person writes it: the `packages` generator in
   `tools/generators/packages/generator.ts` writes it from each package that
   has `runtime/client.ts` or `runtime/server.server.ts`, and `nx sync` holds
   it. The app derives its contracts, commands, jobs and routes from the list.
   `check-contract` fails an app list that lacks a contract.
6. **The event log.** Check each record against its declaration as the log
   commits it, so no server change, job or route sends a record that does not
   fit.
7. **The agent tools.** `toolsOf(contracts)` gives the tool list. A write tool
   runs the server half of its command. A read tool loads a group with the
   access of the caller. Add this part when the project offers tools.

Both paths run side by side in one pool and one server while the branch
moves its packages, so each commit still type checks and passes its tests.

## Step 3: move each package

Move a small package first. Each package is one commit on the branch.

1. **Write `packages/<name>/contract/<name>.ts`.** Declare one `record` for
   each `defineModel`, one `command` for each `defineCommand`, and one `load`
   for each `defineLoad`. Then export `defineContract('<name>', ...)`.
2. **Keep every name.** A record keeps its model name, and a command keeps its
   name. A device may hold a queued transaction that names the command. A
   load function gets a name here, as `<name>/<what-it-loads>` in kebab case.
3. **Translate the fields.** `'array'` becomes `list(...)`, and `'object'`
   becomes `shape(...)`, when the contents have one form. A status or a
   schema of literals becomes `oneOf(...)`. A string with a limit becomes
   `text({ max })` or `text({ min, max })`. `max` has no default. Choose it
   with care, because the snapshot holds it and a lower value is one-way.
4. **Translate the groups.** `groupsOf` becomes a list of group references,
   such as `userGroup.by('id')`. A load function takes the group itself, such
   as `userGroup`, and not a function. A group that a function chose becomes
   a condition on a field, with `when` or `unless` from
   `packages/sync/contract/groups.ts`.
5. **Declare each refusal.** Read the server half. Each reason that it rejects
   with becomes a code in `refuses`. Screens and tools branch on the code. A
   reason that code already compares as text becomes a code first.
6. **Decide each tool.** `tool` has no default. Write `'none'`, or what an
   agent reads before it calls the command.
7. **Move IDs and times into stamps.** An input field that a screen filled
   with an ID of its own or the time becomes a `'new-id'` or `'now'` stamp.
   Remove the call from the screen.
8. **Convert the halves.** The client half becomes
   `localChange(declared, apply)`. The server half becomes your function from
   step 2. Bind the client halves with `clientPackage(contract, [...])` in
   `runtime/client.ts`. Bind the server halves, the jobs and the routes with
   your server twin in `runtime/server.server.ts`. Run `nx sync`, and the app
   lists take the package.
9. **Point each caller at the contract.** A screen runs the command through
   the hook from step 2. Each import of a record or a command names
   `@repo/<name>/contract/<name>`.
10. **Delete what the contract replaces.** Remove each record file in
    `models/`, and each input or record schema in `types/` that the contract
    declares. Rewrite each test that decoded such a schema, or that gave the
    pool the older command.
11. **Move each plain value.** A file in `models/` with no record, such as a
    limit or a pure function, moves to `contract/` as it is. A package with
    only such files needs no contract: `check-contract` asks for one only when
    a file declares a part.
12. **Prove the commit.** Run the type checker, the tests of the package and
    of each feature that uses it, and the contract check:

    ```sh
    mise exec -- bun tools/check-contract.ts --write
    mise exec -- bun tools/check-contract.ts
    ```

    Read the diff of `contract.json`. It is what the package offers on the
    wire. The first snapshot has no base to compare with. After it,
    `check-contract` compares each change with the base branch, and a one-way
    change fails until the snapshot names it under `breaks`. Run the journeys
    of each feature that uses the package.

## Step 4: after the last package

1. Delete the older helpers of your engine: `defineModel`, `defineCommand`,
   `defineServerChange` and `defineLoad`, and the `models/` folder of
   `packages/sync`. Delete the `check-commands` target from `package.json`:
   its file left with the sync.
2. Run `mise exec -- bun run validate`. It passes here for the first time on
   the branch.
3. Run each journey, then open one pull request for the branch.

## What waits for the owner

- A keep-or-take decision on a managed file that the project edited.
- Any change that `check-contract` reports as one-way. Run
  `--accept-breaks` only after the owner agrees to the break.
- A changed prefix in `engine-groups.ts`, or a renamed record or command.
- The date of the move. The branch changes every package, so it lands as one.
