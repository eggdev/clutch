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
- Checks that read the network or the whole repository set `"cache": false`.

A remote cache takes writes only from people who can push to the repository.
Fork PR jobs get read access at most. See [CI](./checks.md#ci).

<!-- kickoff: The remote Nx cache of the project, if any: the server, the read and write token names, and where each token is set. Delete this slot when the project uses only the local cache. -->

## Flags and docs

Never guess a CLI flag. Check `--help` or the Nx docs first.

## Agent instruction files

Do not run `nx configure-ai-agents`. `AGENTS.md` owns agent guidance, and the
command appends a generated Nx block to it or creates a `CLAUDE.md`. Claude Code
reads `AGENTS.md` directly when no `CLAUDE.md` exists.
