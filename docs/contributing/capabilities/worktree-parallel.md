# Worktree / parallel-agent workspace setup

Worktree setup gives each agent task its own Git worktree, so that several agents work in one repository at the same time.

## Why

Rank 3 of the researched practices. More than three quarters of the leading repositories use it (78%). Agents in one checkout overwrite each other's files and servers. A worktree for each task isolates the files, the branch and the local data.

## Detection

`clutch doctor` reports this capability as present when two rules pass. A Markdown file in `docs/` mentions worktrees. `clutch.yaml` has a `worktree.root` key. It is partial when only one rule passes. See the `worktree_parallel` entry in [the registry](./registry.yaml).

## Adopt

1. Add a `worktree` section to `clutch.yaml`. Set `root` to the folder for the worktrees, such as a sibling folder of the checkout.
2. In `copy`, list the untracked files to copy into each worktree, such as `.env.local`.
3. In `setup`, list the commands that prepare each worktree, such as `mise exec -- bun install`.
4. Make sure each checkout uses its own ports and data. A fixed port or a shared temporary folder breaks parallel runs.
5. Document how to create and remove a worktree. [Local development](../setup/local-development.md) shows how the dev URLs of this repository differ in a linked worktree.
6. Set `worktree_parallel` to `adopted` in `clutch.yaml`.

## Waive

Set `worktree_parallel` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when only one agent or person works in the repository at a time.
