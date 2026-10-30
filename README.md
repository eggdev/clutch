<!-- kickoff: Rewrite this file for the product. Keep "Start from a fresh clone" and "Documentation". Delete the template sections. -->

# Clutch

The starting point for a new project. It holds the parts that stay the same in
every project: the engineering principles, the doc structure, the checks, the
import policy and a starter that runs. A kickoff interview with the owner
writes the parts that belong to one product.

Kickoff rewrites this file for the product.

## Deliver a change

Follow the [agent workflow](./docs/contributing/agent-workflow.md) for project
setup, research, design and readiness for parallel or triggered delivery.

After kickoff, ask your agent to use `$deliver` with the feature, fix or task
you want completed. The skill extracts a brief, chooses installed craft skills,
implements, reviews, verifies and continues to the authorized destination.
Use `$deliver` with an existing task record to resume. See
[delivery](./docs/contributing/delivery.md) for ownership and the ready queue.

## Spin it up

```sh
mise install
mise exec -- bun install
mise exec -- bun run dev
```

- `http://clutch.localhost:1355` opens the web app: Vite, React and
  TanStack Router. The notes example shows the sync engine. Open it in two
  tabs, and an edit in one shows in the other.
- `http://api.clutch.localhost:1355` is the API: Bun and Effect, with
  Postgres in the process through PGlite. It needs no database server.
- `bun run dev` uses servers that already run and starts only the missing ones.
  `bun run dev --check` shows which run.
- `mise exec -- bun run validate` runs every check.

[Portless](https://github.com/vercel-labs/portless) gives each app a stable
name in place of a port. See
[local development](./docs/contributing/setup/local-development.md).

Make each new part with a generator, such as
`mise exec -- bun nx g @tools/generators:feature billing`. See
[generators](./docs/contributing/setup/nx.md#generators).

## Start a project

```sh
gh repo create <name> --private --template eggdev/project-template --clone
cd <name>
mise install && mise exec -- bun install
# Open this folder in your agent interface and run the kickoff skill.
```

Kickoff opens with a setup checklist: access, the sign-in provider, tenancy,
MCP and the other capabilities. It applies the engineering defaults without
asking, and spends the interview on product decisions. The choices go into
project intent. In an existing project, the survey fills the checklist from
the code and leaves unknowns open.

## Add review tooling to an existing project

From the receiving project's root, use a current committed template clone:

```sh
bun <clutch clone>/apps/cli/src/main.ts sync --only review --check --json
bun <clutch clone>/apps/cli/src/main.ts sync --only review
```

Then ask the agent to use setup-verification to author the project's committed
`.agents/skills/verify/SKILL.md`. Updates use the same command. A shared file
that the project edited needs the owner's keep-or-take decision. A review sync
does not switch branches or replace product configuration. See [the CLI](./apps/cli/README.md) and
[review architecture](./docs/contributing/architecture/review-runtime.md).

## What is universal and what is per project

| Universal: change it here first            | Per project: kickoff writes it                                        |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `docs/principles/`                         | `docs/contributing/project-intent.md`                                 |
| `docs/contributing/documentation.md`       | `docs/contributing/architecture/`                                     |
| `docs/contributing/harness-engineering.md` | `docs/contributing/architecture/primitives.yaml`: the product entries |
| `docs/contributing/import-boundaries.md`   | `docs/contributing/decisions/0001-*` and later                        |
| `tools/`                                   | `docs/contributing/setup/local-development.md`                        |
| `.agents/skills/kickoff/`                  | `AGENTS.md`, `README.md`                                              |
| `.agents/skills/deliver/`                  | Delivery records in the project's tracker or `.clutch/issues/`        |

A universal page never states a fact about one product. It links to the
project page that owns the fact: the owner, the issue tracker, the journeys,
the vendor owners. A project can take a newer universal page from the template
with a plain copy.

## Start from a fresh clone

```sh
mise install
mise exec -- bun install
mise exec -- bun run validate
```

<!-- kickoff: The command that starts the app, and the URL to open. -->

## Documentation

Agents start at [AGENTS.md](./AGENTS.md). People start at the
[contributor documentation](./docs/contributing/index.md).
