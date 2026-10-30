# One-command local setup

One-command local setup lets a person or an agent start the project from a clean clone, with pinned tools and one command.

## Why

Rank 14 of the researched practices. Almost all of the leading repositories use it (96%). An agent in a clean checkout must reach a running app without guesswork. Pinned tool versions make each machine and each CI run the same.

## Detection

`clutch doctor` reports this capability as present when two rules pass. The root `package.json` has a `dev` script. Git tracks `mise.toml` or `.tool-versions`. It is partial when only one rule passes. See the `dev_bootstrap` entry in [the registry](./registry.yaml).

## Adopt

1. Pin the tool versions in `mise.toml`. This repository pins Bun and Node there.
2. Add a `dev` script to the root `package.json`. In this repository, it runs [`tools/dev.ts`](../../../tools/dev.ts).
3. Document the steps from clone to running app. See [local development](../setup/local-development.md).
4. Set `dev_bootstrap` to `adopted` in `clutch.yaml`.

## Waive

Set `dev_bootstrap` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable for a library with no app to run.
