# Nested / scoped agent rules

Nested agent rules are `AGENTS.md` files in subfolders that give agents the rules for one part of the tree.

## Why

Rank 12 of the researched practices. More than nine in ten of the leading repositories use it (93%). An agent that edits one folder reads the nearest rules first. Scoped rules keep the root file short and put each rule next to its code.

## Detection

`clutch doctor` reports this capability as present when git tracks an `AGENTS.md` file in a subfolder. Files in `.agents/` and `node_modules/` do not count. See the `nested_agent_rules` entry in [the registry](./registry.yaml).

## Adopt

1. Find the folders with their own commands or conventions, such as an app, the tools folder or a shared package.
2. Add an `AGENTS.md` file to each folder. List its commands, its test command, its conventions and its links.
3. Keep each file at 20 lines or fewer, like the [root file](../../../AGENTS.md).
4. When an agent tool reads a different file name, such as `CLAUDE.md`, add that file next to each `AGENTS.md` and include `AGENTS.md` from it.
5. Set `nested_agent_rules` to `adopted` in `clutch.yaml`.

## Waive

Set `nested_agent_rules` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable for a small repository where the root file covers every folder.
