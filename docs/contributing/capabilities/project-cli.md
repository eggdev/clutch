# Project task runner / CLI (just, make, mise, xtask, hogli, dda)

A project task runner gives the commands of the repository one entry point, so agents call named tasks instead of long command lines.

## Why

Rank 39 of the researched practices. About half of the leading repositories use it (48%). A named task holds the flags and the order that an agent would otherwise guess. One entry point also gives each command its help text.

## Detection

`clutch doctor` reports this capability as present when an `apps/*/package.json` file declares `bin`, or git tracks a `justfile` or a `Makefile` at the root. See the `project_cli` entry in [the registry](./registry.yaml).

## Adopt

1. Pick a runner: a CLI app with a `bin` entry, a `justfile` or a `Makefile`.
2. This repository ships the Clutch CLI in `apps/cli/`. Its [`package.json`](../../../apps/cli/package.json) declares the `bin` entry.
3. Run the CLI with `mise exec -- bun run clutch <command>`. Read the [CLI README](../../../apps/cli/README.md) for its commands.
4. Set `project_cli` to `adopted` in `clutch.yaml`.

## Waive

Set `project_cli` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when the root `package.json` scripts cover every task.
