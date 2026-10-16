<!-- kickoff: Rewrite this file for the product. Keep "Start from a fresh clone" and "Documentation". Delete the template sections. -->

# Project template

The starting point for a new project. It holds the parts that stay the same in
every project: the engineering principles, the doc structure, the checks and
the import policy. A kickoff interview with the owner writes the parts that
belong to one product.

Kickoff rewrites this file for the product.

## Start a project

```sh
gh repo create <name> --private --template eggdev/project-template --clone
cd <name>
mise install && mise exec -- bun install
claude "/kickoff"     # or: codex "\$kickoff"
```

## What is universal and what is per project

| Universal: change it here first               | Per project: kickoff writes it                 |
| --------------------------------------------- | ---------------------------------------------- |
| `docs/principles/`                            | `docs/contributing/project-intent.md`          |
| `docs/contributing/documentation.md`          | `docs/contributing/architecture/`              |
| `docs/contributing/harness-engineering.md`    | `docs/contributing/decisions/0001-*` and later |
| `docs/contributing/import-boundaries.md`      | `docs/contributing/setup/local-development.md` |
| `tools/`, except `tools/lint/boundaries.json` | `tools/lint/boundaries.json`                   |
| `.agents/skills/kickoff/`                     | `AGENTS.md`, `README.md`                       |

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
