# Nx

Run every build, lint, test and typecheck task through Nx. Do not call the
underlying tool directly.

```sh
mise exec -- bun nx run-many -t test typecheck lint
mise exec -- bun nx affected -t test
mise exec -- bun nx show projects
```

Prefix each command with `mise exec -- bun`. That uses the workspace's pinned
Bun and Nx, and never a global CLI. The root project is named after the root
`package.json`. Packages are `@repo/<package>`.

## Generators

Make a package, a record, a command, a job or a feature with a generator. Do not
copy files by hand. A generator writes the shape that the checks expect, then
registers the result.

| Generator | Example                                                                                                                 | Writes and registers                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package` | `mise exec -- bun nx g @tools/generators:package billing --sections=contract,repo,runtime --record=invoice --group=org` | Only the named sections, the package contract and a primitive. With `--record`: the first record and its table in `repo/`. With `repo/`: the drizzle-kit config, `db-generate` and the migrations in `runtime/server.server.ts` |
| `record`  | `mise exec -- bun nx g @tools/generators:record billing invoice --group=space:spaceId`                                  | The record in the package's `contract/`, with its sync group. In a package with `repo/`, its table and row mapping                                                                                                              |
| `command` | `mise exec -- bun nx g @tools/generators:command billing pay-invoice --record=invoice --waits=server --access=group`    | The command in the package's `contract/`, its server change and, with `--waits=local`, its local change. Both halves register in `runtime/`                                                                                     |
| `job`     | `mise exec -- bun nx g @tools/generators:job billing send-invoice`                                                      | A job in `jobs/`, registered in the package's `runtime/server.server.ts`                                                                                                                                                        |
| `feature` | `mise exec -- bun nx g @tools/generators:feature billing`                                                               | The gate, a screen, `components/`, a route in the client app, the gate in the lint options, and a primitive                                                                                                                     |

`--sections` has no default. Choose the sections on purpose. A package needs
`contract/` or `types/`. `commands/` needs `contract/`. `repo/` needs `runtime/`
and `--record`. A record needs `--group`: `org`, `user`, or `<kind>:<field>`,
such as `space:spaceId`. A package owns no record until `--record` or the
`record` generator adds one.

No generator writes a migration. After a schema change, run
`mise exec -- bun nx run @repo/<package>:db-generate`. See
[migrations](./migrations.md#only-drizzle-kit-writes-migrations).

Each generator then installs the workspace links, runs `nx sync` for the
tsconfig references, and formats each file. Add `--dry-run` to see the files
first.

`nx sync` also runs the `packages` sync generator in `tools/generators/packages/`.
It writes `packages.ts` in each client app and each server app, from the packages
that have `runtime/client.ts` or `runtime/server.server.ts`.

A generated command refuses each run until you write its server change. A
command with `waits: 'local'` also gets a local change to write. A generated
feature has no caller. The first button or link that opens it calls
the gate.

The generators are a local Nx plugin in `tools/generators/`. Node loads them
with its built-in type stripping. One generator file imports another with the
`.ts` extension, because Node does not read tsconfig `paths`.

## Cache keys

Nx hashes the inputs of each target and reuses a stored result when the hash
matches. `nx.json` sets the inputs in `targetDefaults`.

- The `test` and `lint-policy-test` hashes include the `CI` environment
  variable, `bunfig.toml` and `tools/testing/`. A test runner can act
  differently under `CI`, so a result from one mode never stands in for the
  other.
- The `validate` script and the CI workflow both set `CI=1`. An agent run of
  `validate` and a CI run hash the same inputs, so they share results.
- A plain `nx run-many -t test` without `CI=1` has its own keys. It misses the
  `validate` results and gives the same answers.
- Typecheck and lint hashes leave out `CI`, because nothing they run reads it.
- The lint hash includes the workspace manifests and the `ultracite` and
  `yaml` versions. The lint config and the import policy read them.
- The root project's `default` input leaves out the files of nested
  projects. `format-check` reads every file, so its input is
  `{workspaceRoot}/**/*`.
- Checks that read the network or the whole repository set `"cache": false`.
- A run-commands target with no `cache` setting is never cached. Give each new
  target a `cache` value.

Nx keeps results only in the local cache. `nx.json` sets `neverConnectToCloud`,
so Nx never connects to Nx Cloud. A project that adds a shared cache gives
write access only to people who can push. See [CI](./checks.md#ci).

## Flags and docs

Never guess a CLI flag. Check `--help` or the Nx docs first.

## Agent instruction files

Do not run `nx configure-ai-agents`. `AGENTS.md` owns agent guidance, and the
command appends a generated Nx block to it or creates a `CLAUDE.md`. Claude Code
reads `AGENTS.md` directly when no `CLAUDE.md` exists.
