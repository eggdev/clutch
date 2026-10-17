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
- The lint hash includes the workspace manifests and the `ultracite` and
  `yaml` versions. The lint config and the import policy read them.
- The root project's `default` input leaves out the files of nested
  projects. `format-check` reads every file, so its input is
  `{workspaceRoot}/**/*`.
- Checks that read the network or the whole repository set `"cache": false`.
- A run-commands target with no `cache` setting is never cached. Give each new
  target a `cache` value.

A remote cache takes writes only from people who can push to the repository.
Fork PR jobs get read access at most. See [CI](./checks.md#ci).

## Remote cache

[`apps/nx-cache`](../../../apps/nx-cache/README.md) is a Cloudflare Worker that
stores Nx task results in an R2 bucket. It serves the Nx self-hosted remote
cache API. CI and every contributor share its results. `nx.json` sets
`neverConnectToCloud`, so Nx never connects to Nx Cloud.

The worker accepts two bearer tokens:

| Token | GitHub secret          | Worker secret       | Can         | Who gets it                                                                                       |
| ----- | ---------------------- | ------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| Write | `NX_CACHE_WRITE_TOKEN` | `CACHE_WRITE_TOKEN` | Read, write | People who can push, and CI runs on a push, a manual run or a PR from a branch of this repository |
| Read  | `NX_CACHE_READ_TOKEN`  | `CACHE_READ_TOKEN`  | Read        | CI runs on a PR from a fork                                                                       |

A PUT with the read token gets `403`, and Nx skips the upload. GitHub
withholds secrets from a fork PR unless a repository setting sends them. A fork
PR with no token uses only the local cache.

The first PUT of a hash wins. A second PUT gets `409`, so a bad upload cannot
replace a stored result. R2 deletes each result 14 days after the upload. A
read does not extend that time.

### Use the cache

Get the write token from the password manager. Then set two variables in your
shell:

```sh
export NX_SELF_HOSTED_REMOTE_CACHE_SERVER=<the NX_CACHE_URL variable of the repository>
export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN=<the write token>
```

Nx stops the run when the cache is unreachable or refuses the token. When you
work offline, or the cache is down, unset both variables. Nx then uses only the
local cache:

```sh
unset NX_SELF_HOSTED_REMOTE_CACHE_SERVER NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN
```

CI does a check before `validate`. It reads `/health` and one cache key. It
turns the cache on only when both answers are correct. Otherwise it prints a
warning, and `validate` uses the local cache.

### Set up the cache

Do these steps one time, with a Cloudflare API token that can edit Workers and
R2. Run each command from the repository root.

1. Make two tokens. Keep both in the password manager:

   ```sh
   openssl rand -hex 32   # the write token
   openssl rand -hex 32   # the read token
   ```

2. Make the bucket. Add a rule that deletes results after 14 days and stops an
   incomplete multipart upload after 1 day:

   ```sh
   bun x wrangler r2 bucket create project-template-nx-cache
   bun x wrangler r2 bucket lifecycle add project-template-nx-cache expire-results v1/ --expire-days 14 --abort-multipart-days 1 --force
   ```

3. Set the GitHub secrets and the account variable:

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN
   gh variable set CLOUDFLARE_ACCOUNT_ID --body <account id>
   gh secret set NX_CACHE_WRITE_TOKEN
   gh secret set NX_CACHE_READ_TOKEN
   ```

4. Deploy the worker. Read its `workers.dev` URL in the deploy log:

   ```sh
   gh workflow run nx-cache.yml --ref main
   ```

5. Set the worker secrets and the URL variable:

   ```sh
   bun x wrangler secret put CACHE_WRITE_TOKEN --config apps/nx-cache/wrangler.jsonc
   bun x wrangler secret put CACHE_READ_TOKEN --config apps/nx-cache/wrangler.jsonc
   gh variable set NX_CACHE_URL --body https://<worker URL>
   ```

The next CI run prints `The Nx remote cache is on`. To change a token, do
steps 3 and 5 for that token again.

## Flags and docs

Never guess a CLI flag. Check `--help` or the Nx docs first.

## Agent instruction files

Do not run `nx configure-ai-agents`. `AGENTS.md` owns agent guidance, and the
command appends a generated Nx block to it or creates a `CLAUDE.md`. Claude Code
reads `AGENTS.md` directly when no `CLAUDE.md` exists.
