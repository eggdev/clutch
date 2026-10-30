# Root AGENTS.md

A root `AGENTS.md` is one Markdown file at the repository root that gives agents a map of the project.

## Why

Rank 1 of the researched practices. About nine in ten of the leading repositories use it (89%). An agent reads this file first. A short map saves it from a blind search of the tree.

## Detection

`clutch doctor` reports this capability as present when git tracks an `AGENTS.md` file at the repository root. See the `root_agents_md` entry in [the registry](./registry.yaml).

## Adopt

1. Add `AGENTS.md` at the repository root. The [`AGENTS.md`](../../../AGENTS.md) of this repository is an example.
2. Name the one command that runs every check, such as `mise exec -- bun run validate`.
3. Link the page that owns each task. Keep the file a map, not the docs.
4. Keep the file short. `check-file-size` rejects an `AGENTS.md` over 20 lines.
5. When an agent tool reads a different file name, such as `CLAUDE.md`, include `AGENTS.md` from that file.
6. Set `root_agents_md` to `adopted` in `clutch.yaml`.

## Waive

Set `root_agents_md` to `waived` in `clutch.yaml` with a reason. A waiver is rarely reasonable, because each agent needs a map. One case is a repository that agents never edit.
