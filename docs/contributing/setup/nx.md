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

## Flags and docs

Never guess a CLI flag. Check `--help` or the Nx docs first.

## Agent instruction files

Do not run `nx configure-ai-agents`. `AGENTS.md` owns agent guidance, and the
command appends a generated Nx block to it or creates a `CLAUDE.md`. Claude Code
reads `AGENTS.md` directly when no `CLAUDE.md` exists.
