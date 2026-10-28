# 0005: Effect is the server language

- **Status:** accepted
- **Date:** 2026-10-28

## Context

Server code needs typed errors, services that a test can replace, and safe
resource use. Without one standard, each package picks its own error shape
and its own way to inject a dependency. A vendor can be replaced. A language
cannot, so this choice is a
[one-way door](../../principles/two-way-doors.md).

## Decision

All server code uses Effect 4. The sync package uses Effect too, on the server
and in its client chunk. Other client code does not use Effect. A command's
local change stays plain TypeScript.

Effect Schema is the only schema language, on the server and the client. Zod,
Yup, Valibot and ArkType are not allowed. `types/` holds hand-written schemas.
A schema is never generated from a table, because that puts the storage shape
in the interface of the package. `repo/` maps rows to records.

Rules for Effect code:

- Effect is a language in the registry. It is allowed in `.server.ts` files,
  `service/`, `repo/`, `runtime/` and `packages/sync`.
- Only an edge runs an Effect: `runtime/` and the composition root. Only an
  edge calls `Effect.runPromise`, `runSync` or `runFork`.
- `service/` and `.server.ts` files do not use `throw`, `async` or a bare
  `Promise`. Errors are tagged.
- Each service is a `Context.Tag` and a Layer.

## Consequences

- Every package has the same error shape and the same seam for tests.
- Agents write Effect less well than plain TypeScript. The rules above, lint
  rules and examples must carry that load.
- An Effect major version is a planned upgrade for every project at once.
- Each repo has a test that converts a row to its record and back.

**Revisit if:** Effect stops major releases for a year, or its server
packages fall two minor versions behind its core.
