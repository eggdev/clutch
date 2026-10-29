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

Make a package, a feature, a command or a model with a generator. Do not copy
files by hand. A generator writes the shape that the checks expect, then
registers the result.

| Generator | Example                                                                                                                     | Writes and registers                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package` | `mise exec -- bun nx g @tools/generators:package billing --sections=types,models,repo,runtime --record=invoice --group=org` | Only the named sections and a primitive. With `--record`: its schema, model and table. With `repo/`: the drizzle-kit config, `db-generate` and the API migration entry |
| `model`   | `mise exec -- bun nx g @tools/generators:model billing payment --group=space:spaceId`                                       | The record schema in `types/`, its model in `models/` and, in a package with `repo/`, its table and row mapping                                                        |
| `command` | `mise exec -- bun nx g @tools/generators:command billing pay-invoice --model=invoice --waits=server --access=group`         | The paired command files, the input schema, and both halves in `runtime/` and in the apps                                                                              |
| `job`     | `mise exec -- bun nx g @tools/generators:job billing send-invoice`                                                          | A job in `jobs/`, registered in the package and in the server app                                                                                                      |
| `feature` | `mise exec -- bun nx g @tools/generators:feature billing`                                                                   | The gate, a screen, `components/`, a route in `apps/web`, the gate in the lint options, and a primitive                                                                |

`--sections` has no default. Choose the sections on purpose. A package owns no
record until `--record` names one. A record needs `--group`: `org`, `user`, or
`<kind>:<field>`, such as `space:spaceId`. A package with `repo/` needs
`runtime/` and a record.

No generator writes a migration. After a schema change, run
`mise exec -- bun nx run @repo/<package>:db-generate`. See
[migrations](./migrations.md#only-drizzle-kit-writes-migrations).

Each generator then installs the workspace links, runs `nx sync` for the
tsconfig references, and formats each file. Add `--dry-run` to see the files
first.

A generated command rejects each run until you write its server change. A
generated feature has no caller. The first button or link that opens it calls
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
