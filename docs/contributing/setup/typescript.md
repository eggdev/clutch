# TypeScript

Each runtime gets its own TypeScript environment. Code for a browser, a server
runtime and a test runner see different globals, so one shared config would let
a global type-check in code that cannot use it.

## One config for each environment

| Config                | Covers                                    | Leaves out                    |
| --------------------- | ----------------------------------------- | ----------------------------- |
| `tsconfig.lib.json`   | The production source of a package or app | Test files and test types     |
| `tsconfig.spec.json`  | The tests and `src/testing/`              | Nothing that the tests import |
| `tools/tsconfig.json` | Repository tools and their tests          | App and package source        |

- Production configs leave out test files and test types, so `expect` or a test
  global in production code fails the typecheck.
- Each config names its runtime library: `DOM` for a browser, the platform types
  for a worker, `bun` types for a Bun script.
- The root `tsconfig.json` has no `include`. It references each project, and
  `mise exec -- bun run validate` checks every config through Nx.

## Generated types

Some types come from a generator: platform bindings, route types, database
schema types. Commit the generated file. Its generator runs as an Nx target,
and a check runs it again and fails when the output differs from the committed
file. A stale copy then fails on every machine, not only on the next one that
regenerates it.

<!-- kickoff: Each type generator: the command, the file it writes, and the Nx target and check that keep it current. Delete this slot when the project has no generator. -->

## The first package

When you add the first package or app:

1. Add `tsconfig.lib.json` and `tsconfig.spec.json`, both extending the root
   `tsconfig.base.json`.
2. Reference the project from the root `tsconfig.json`.
3. Run `mise exec -- bun x nx show project <name>` and confirm a `typecheck`
   target exists.
4. Put a test global in a production file once, and confirm the typecheck
   fails. Then remove it.
