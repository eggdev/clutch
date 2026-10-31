# Worktrees

Run several tasks in one repository at once, each in its own checkout. Each
checkout has its own branch, dependencies, ports, data and test output, so the
tasks do not share state. `clutch worktree` makes and removes the checkouts.
See [the CLI](../../../apps/cli/README.md#worktree).

```sh
mise exec -- bun run clutch worktree new cart-total --issue CL-201
mise exec -- bun run clutch worktree list
mise exec -- bun run clutch worktree rm cart-total
```

## What each checkout has of its own

| State                      | Where it lives                         | Why it does not collide                                                                                                                  |
| -------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Dependencies and git hooks | `node_modules`, installed by the setup | Each checkout runs `bun install`.                                                                                                        |
| Dev servers                | `http://<branch>.<app>.localhost:1355` | Portless runs one proxy on port 1355 and gives each server its own port. In a linked worktree it adds the branch name to each host name. |
| Dev run record and lock    | `.data/dev.lock`, `.data/dev-run.json` | Both are in the checkout. `dev --stop` stops only the servers of its own checkout.                                                       |
| Local database             | `apps/api/.data/pglite`                | PGlite keeps its files in the checkout. Tests use in-memory PGlite.                                                                      |
| Journey output             | `test-results/journeys`                | Playwright writes in the checkout. Each journey runs against its own checkout's dev servers.                                             |

Port 1355 is shared on purpose. It is the one proxy, and it routes by host
name. The API's `PORT` default of 4000 and the web app's `DEV_API_URL`
fallback apply only outside `bun run dev`, which sets both.

## Settings

The `worktree` block of `clutch.yaml` sets where the checkouts go, which
untracked files to copy, and the setup commands:

```yaml
worktree:
  root: ../clutch.worktrees
  copy: [.env.local]
  setup: ['mise trust --quiet', 'mise exec -- bun install']
```

Without the block, the checkouts go in `../<repo>.worktrees`, nothing is
copied, and the setup is the two commands above. mise refuses a config file
in a new folder until it is trusted.

## Remove a checkout

`clutch worktree rm <slug>` refuses a checkout with uncommitted changes, or
with commits that neither the base nor a remote branch holds. Push the work,
or pass `--force` to lose it. It stops that checkout's dev servers first,
through `bun run dev --stop`, and leaves the other checkouts running. It
deletes the branch only when the branch is merged into the base.

## An external database

The template's database is PGlite, so each checkout has its own. A project
with an external database, such as a Postgres server, must give each checkout
its own database name. `clutch.yaml` has no hook for that yet. Add one when a
project needs it.
