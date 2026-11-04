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

1. Run `clutch sync`. A project that has no tree gets Clutch's starter tree at `factory/` once. It holds the 5 stage agents `triage`, `spec`, `implement`, `review` and `verify`, the runner `runners/spark.yaml`, the scorer `scorers/acceptance-criteria/` and `models.yaml`. The tree is a seed, so the project owns it after that.
2. Tune each agent's prompt to the project. Change a runner or a model when the project runs on other machines. Set the `base_url` of each Qwen model in `models.yaml` to its server, or change the scorer's `judge`.
3. Run `mise exec -- bun run clutch factory --check`. The [factory tree schema](../architecture/factory-tree.md) names each path and key.
4. Set `factory_as_code` to `adopted` in `clutch.yaml`.

When Clutch changes its copy of a tree file, the sync PR names the file with a compare link. Port what applies.

## Docs that agents read

Each agent's `reads` names the docs that it must read, and its prompt links each one. `clutch factory --check` fails when a path does not exist, so a project whose docs do not follow Clutch's layout fails the check. Clutch's layout, from the project root:

| Path                                      | Holds                                           |
| ----------------------------------------- | ----------------------------------------------- |
| `AGENTS.md`                               | The agent index: the validate command and a map |
| `docs/contributing/index.md`              | The map of the contributor docs                 |
| `docs/contributing/project-intent.md`     | What the project is for                         |
| `docs/principles/`                        | The engineering principles                      |
| `docs/contributing/architecture/index.md` | The map of the code                             |
| `docs/contributing/testing.md`            | How to test a change                            |
| `docs/contributing/review.md`             | The review rules and the finding levels         |
| `docs/contributing/stage-agents.md`       | The hand-off contract between the stage agents  |
| `.clutch/README.md`                       | The issue tracker and its states                |
| `.agents/skills/deliver/SKILL.md`         | The deliver skill                               |
| `.agents/skills/verify/SKILL.md`          | The project's own verify skill                  |

The starter agents read these docs:

| Agent       | `reads`                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `triage`    | `AGENTS.md`, `.clutch/README.md`, `docs/contributing/project-intent.md`, the deliver skill, the hand-off contract                |
| `spec`      | `docs/contributing/architecture/index.md`, the deliver skill's research and design reference, the hand-off contract              |
| `implement` | `AGENTS.md`, `docs/contributing/architecture/index.md`, `docs/contributing/testing.md`, the deliver skill, the hand-off contract |
| `review`    | `docs/contributing/review.md`, the hand-off contract                                                                             |
| `verify`    | The verify skill, the hand-off contract                                                                                          |

The [factory tree schema](../architecture/factory-tree.md#agentmd) says how to write `reads` and its links.

## Ready for the factory

C-Suite's intake starts a lane for work that a project marks as ready. `factory.intake` in `clutch.yaml` names that work:

```yaml
factory:
  intake:
    github: [factory] # issue labels that C-Suite's GitHub intake watches
    linear: [] # Linear issue labels
    tracker: [todo] # .clutch/issues states, for an issue with owner: agent outside later
```

| Key       | Default     | Value                                                                                                      |
| --------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `github`  | `[factory]` | GitHub issue labels. C-Suite's `github-intake` automation watches `factory`                                |
| `linear`  | `[]`        | Linear issue labels                                                                                        |
| `tracker` | `[todo]`    | At least 1 state from `todo`, `in_progress`, `blocked`, `review` and `done`. `clutch issues next` reads it |

The project's tracker docs name the same values in a "Ready for the factory" section of `.clutch/README.md`. The section has one list line for each key, and each value is in backticks. A tracker state is written as `` `status: <state>` ``:

```markdown
## Ready for the factory

- GitHub: an issue with the label `factory`.
- Linear: no label.
- Tracker: an issue file with `status: todo` and `owner: agent`, outside the `later` phase.
```

`clutch factory --check` fails when the section and `clutch.yaml` disagree, or when `clutch.yaml` sets `factory.intake` and the section is missing. Without `factory.intake`, a section must name the defaults. A project with neither passes. The check makes no label in GitHub. Make the label once, in the repository's settings or with `gh label create factory`.

## Waive

Set `factory_as_code` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when no agent works on the repository without a person who starts it by hand.
