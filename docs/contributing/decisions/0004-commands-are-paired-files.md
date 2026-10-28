# 0004: A command is two files with one name

- **Status:** accepted
- **Date:** 2026-10-28

## Context

A command is one definition: the local change, the server change and whether
it waits for the server. The client must not load server code. One file
cannot hold both halves unless a bundler plugin removes the server half, and
agents put the line in the wrong place with that kind of plugin.

## Decision

A command is two files in `commands/`, with one name:

- `<name>.ts` holds the input, the local change and `waits`. The local change
  is plain TypeScript, with no Effect.
- `<name>.server.ts` holds the server change, in Effect.

`waits` is `'local'` or `'server'`. It is required and has no default.

Only these files can import a `.server.ts` file:

- other `.server.ts` files
- `service/` and `repo/`
- `runtime/`
- server apps, such as `apps/api`
- tests

Each package registers its server changes in `runtime/handlers.server.ts`. The
server app loads that file.

## Consequences

- A check rejects a command without its `.server.ts` file, and a `.server.ts`
  file without its command.
- Knip rejects a `.server.ts` file that no `runtime/` file registers.
- The lint message names the fix: register the server change in
  `runtime/handlers.server.ts`. An agent does not stop at a rule that blocks
  every import.
- The list of server-confirmed writes on the sync page is generated from
  `waits`, so it does not drift from the code.

**Revisit if:** a bundler plugin can split one file into a client half and a
server half, and a check proves the split is right.
