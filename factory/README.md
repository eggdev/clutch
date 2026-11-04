# Factory

This folder is the project's factory tree: the agents that work on the
project, the machines that run them and the models that they may use. The
[factory tree schema](https://github.com/eggdev/clutch/blob/main/docs/contributing/architecture/factory-tree.md)
names each path and key. `mise exec -- bun run clutch factory --check` checks
the tree, and `validate` runs it as `check-factory`.

| Path                     | Holds                                                        |
| ------------------------ | ------------------------------------------------------------ |
| `agents/<name>/agent.md` | One stage agent: its role, harness, model, runner and prompt |
| `runners/<name>.yaml`    | A machine that runs agents                                   |
| `models.yaml`            | Each model that an agent or a scorer may name                |

Clutch installs this tree once, as a seed. The project owns it after that, so
tune each prompt to the project. When Clutch changes its copy of a file, the
sync PR names the file and links the change. Port what applies.

The 5 stage agents are `triage`, `spec`, `implement`, `review` and `verify`.
The foreman that hands work to them lives in C-Suite, so this tree has none.
