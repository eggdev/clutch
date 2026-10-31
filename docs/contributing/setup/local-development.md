# Local development

## Tools

[mise](https://mise.jdx.dev) pins Bun and Node in `mise.toml`. Run each command
through it:

```sh
mise install
mise exec -- bun install
mise exec -- bun run validate
```

`bun install` also installs the Git hooks. See
[Git hooks](./checks.md#git-hooks).

## Start the app

```sh
mise exec -- bun run dev
```

This is the only way to start the dev servers. It runs
[`tools/dev.ts`](../../../tools/dev.ts), which starts each app with an Nx `dev`
target through [portless](https://github.com/vercel-labs/portless). Portless
gives each app a stable name in place of a port:

| App        | Command                   | URL                                |
| ---------- | ------------------------- | ---------------------------------- |
| `apps/web` | `vite`                    | `http://clutch.localhost:1355`     |
| `apps/api` | `bun --watch src/main.ts` | `http://api.clutch.localhost:1355` |

The name comes from the root `package.json` name. The web app gets the bare
name, and each other app gets `<app>.<name>`. In a linked Git worktree,
portless puts the branch name in front, so two checkouts never collide.

The API keeps Postgres in the process with PGlite, in `apps/api/.data/pglite`,
so it needs no database server. It runs the migrations before it takes a
request. The web app sends `/sync` to the API, so the browser has one origin.
Delete `apps/api/.data/` to start from an empty database.

## One copy of each server

The dev command never starts a second copy of a server:

1. It asks portless for the URL of each app.
2. It sends each app a health request through the portless proxy. The API
   answers `/health`, and the web app answers `/`.
3. It uses each server that answers again, and prints `reused`.
4. It starts each missing app, and waits until the app answers. Then it prints
   `started`.
5. When every server already runs, it prints the URLs and exits.

A lock file, `.data/dev.lock`, holds a second run until the first one has
started its servers. The second run then finds them and uses them again.

`mise exec -- bun run dev --check` prints `up` or `down` for each app. It exits
1 when an app is down.

`mise exec -- bun run dev --stop` stops the servers that a dev run in this
checkout started, and no others. While a run starts servers, it keeps
`.data/dev-run.json` with its own process id and each server's. `--stop` checks
each process's command line before it signals it, so a reused process id is
never hit. It stops the run, then kills any server left after 10 seconds.
`clutch worktree rm` runs it before it removes a checkout. See
[Worktrees](./worktrees.md).

An agent hook refuses commands that start a server directly: `vite`,
`bun --watch`, an Nx `dev` target, `portless run`, `expo start` and `one dev`.
Its message points to the dev command. See
[agent hooks](../harness-engineering.md#agent-hooks). The same hook refuses
commands that start a simulator or make a native build. See
[native builds and devices](./native.md).

## Plain HTTP by default

Portless runs on port 1355 with plain HTTP. That port needs no `sudo`, and
plain HTTP needs no trusted certificate. For HTTPS, run
`mise exec -- bunx portless trust` once. Then set `PORTLESS_HTTPS=1` and
`PORTLESS_PORT=443` before the dev command. Trust adds a local certificate
authority to your system, so a person does it, never an agent.

<!-- kickoff: How to start each other app and local service, with the command and the URL. -->

A start command for each other app or service must be safe to run again, in
the same way. Add it as an Nx `dev` target, so the dev command starts it.

The workflow also exposes status, logs and stop for this task's stack. A stop
never shuts down another task. Document process ownership and restart behavior
so a replacement session can restore the same review environment.

UI checks use the real browser or native app. They never read a rendered
string in place of the interface. Follow [verification setup](./verification.md)
for platform access and criterion evidence.

## Configuration

<!-- kickoff: Configuration: where each secret lives, the example file to copy, and which values a fresh clone needs. -->
