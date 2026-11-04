# Factory as code

A factory tree is a folder of files. It names each agent that works on the repository, with the machine that runs it and the model that it uses. `clutch factory --check` rejects a bad tree, and `validate` runs it as `check-factory`.

## Why

Without the tree, each agent's prompt, model and machine live in a person's head or in one tool's settings. With it, a change to an agent is a pull request that the check and a reviewer read. A self-improvement loop can open that pull request too. The format is the one that C-Suite uses, so the work across projects and the work in each project read the same files. See layer 00 of [the factory stack](https://github.com/eggdev/c-suite/blob/main/docs/stack.md) in C-Suite.

## Detection

`clutch doctor` reports this capability as present when both rules pass:

- `factory: agents`: git tracks a file that matches `agents/*/agent.md` in the tree root. The tree root is `factory.root` in `clutch.yaml`, or `factory/`.
- `factory: check`: the tree passes `clutch factory --check`. The check reads the working tree.

A tree that fails the check is partial, and the evidence says how many problems the check found. See the `factory_as_code` entry in [the registry](./registry.yaml).

## Adopt

1. Run `clutch sync`. A project that has no tree gets Clutch's starter tree at `factory/` once. It holds the 5 stage agents `triage`, `spec`, `implement`, `review` and `verify`, the runner `runners/spark.yaml` and `models.yaml`. The tree is a seed, so the project owns it after that.
2. Tune each agent's prompt to the project. Change a runner or a model when the project runs on other machines.
3. Run `mise exec -- bun run clutch factory --check`. The [factory tree schema](../architecture/factory-tree.md) names each path and key.
4. Set `factory_as_code` to `adopted` in `clutch.yaml`.

When Clutch changes its copy of a tree file, the sync PR names the file with a compare link. Port what applies.

## Waive

Set `factory_as_code` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when no agent works on the repository without a person who starts it by hand.
