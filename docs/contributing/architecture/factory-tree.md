# Factory tree

A project's factory is a tree of files. The path of a file is its name. The
frontmatter holds the settings, and the body holds the prompt.
`clutch factory --check` reads the tree. It rejects an unknown key, a bad
value, an empty prompt and a name that points at no file. `validate` runs it
as `check-factory`, so `pre-push` and CI run it too.

## Paths

| Path                               | Holds                                          | Body             |
| ---------------------------------- | ---------------------------------------------- | ---------------- |
| `agents/<name>/agent.md`           | One agent: its role, harness, model and runner | The prompt       |
| `automations/<name>/automation.md` | What starts an agent without a person          | The start prompt |
| `runners/<name>.yaml`              | A machine that runs agents                     | None             |
| `scorers/<name>/scorer.md`         | A judge that grades the runs of some agents    | The judge prompt |
| `models.yaml`                      | Each model that an agent or a scorer may name  | None             |
| `benchmarks/<name>/benchmark.md`   | A suite that compares models on pinned tasks   | What it measures |

- The paths start at the tree root. The tree root is `factory/` at the project
  root. Set `factory.root` in `clutch.yaml` to move it. `root: .` puts the
  tree at the project root. `--root DIR` checks a tree at `DIR` for one run.
- A name is lowercase kebab case, such as `task-compliance`.
- A `README.md` can sit at the tree root and in each kind's folder. A file in
  a kind's folder that is not an item of that kind is a problem. An item
  folder can hold other files beside its main file.
- Skills live in `.agents/skills/`, so the tree has no `skills/` folder.
- A benchmark folder can hold a `results/` folder beside its `benchmark.md`.
- A project with no tree at the default `factory/` passes with a notice. A
  root that `--root` or `factory.root` names must be a folder, or the check
  fails. `apps/cli/src/factory-command.test.ts` tests both cases.

## agent.md

```markdown
---
role: implement
description: Builds one issue and opens its pull request.
harness: claude
model: claude-opus-5-5
runner: spark
---

Follow the deliver skill for the issue you get.
```

| Key           | Required | Value                                                                  |
| ------------- | -------- | ---------------------------------------------------------------------- |
| `role`        | Yes      | `foreman`, `triage`, `spec`, `implement`, `review`, `verify`, `custom` |
| `description` | Yes      | One line that says when to use the agent                               |
| `harness`     | Yes      | `claude`, `codex` or `qwen`                                            |
| `model`       | Yes      | An `id` in `models.yaml`                                               |
| `runner`      | Yes      | The name of a file in `runners/`                                       |

## automation.md

```markdown
---
description: Sorts the new issues each weekday night.
agent: triage
trigger:
  type: schedule
  time: '22:00'
  weekdays: [1, 2, 3, 4, 5]
enabled: true
---

Sort each issue that arrived today.
```

| Key           | Required | Value                                                       |
| ------------- | -------- | ----------------------------------------------------------- |
| `description` | No       | One line that says what the automation does                 |
| `agent`       | Yes      | The name of a folder in `agents/`                           |
| `trigger`     | Yes      | A map. Its `type` sets the other keys of the map. See below |
| `enabled`     | No       | `false` stops the automation. The default is `true`         |

| `trigger.type` | Other keys                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `schedule`     | `time` (required): the runner's local time as `HH:MM`. `weekdays`: 0 to 6, and 0 is Sunday. Without it, the automation runs each day |
| `github`       | `event` (required): an event in snake case, such as `issue_labeled`. `label`: only an issue or a PR with this label                  |
| `linear`       | `label`: only an issue with this label                                                                                               |
| `webhook`      | None                                                                                                                                 |

## runners/\<name\>.yaml

```yaml
description: The DGX Spark, where each lane runs.
machine: spark
t3_environment: a3789960-af7f-4761-ae81-b7f6fc8968d2
ssh: agent-dgx
workspace: worktree
setup:
  - mise trust --quiet
```

| Key              | Required | Value                                                                                                            |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `description`    | Yes      | One line that says what the machine is for                                                                       |
| `machine`        | Yes      | The host name of the machine                                                                                     |
| `t3_environment` | Yes      | The T3 environment id of the machine, or `local`                                                                 |
| `workspace`      | Yes      | `worktree`: each lane gets its own git worktree. `main_checkout`: one agent at a time works in the main checkout |
| `ssh`            | No       | The SSH host alias that reaches the machine                                                                      |
| `setup`          | No       | A list of shell commands that make the machine ready, in order                                                   |

## scorer.md

```markdown
---
description: Grades each implement run against its issue.
agents: [implement]
judge: qwen3.8-27b
labels:
  - value: complete
    score: 1
    description: The pull request does what the issue asks, and nothing more.
  - value: partial
    score: 0.5
    description: The pull request does part of what the issue asks.
  - value: off_task
    score: 0
    description: The pull request does not do what the issue asks.
passingScore: 1
samplingRate: 25
---

Compare the pull request with its issue. Return one label and one sentence that says why.
```

| Key            | Required | Value                                                                                                        |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `description`  | No       | One line that says what the scorer grades                                                                    |
| `agents`       | Yes      | The names of the agents whose runs the scorer grades                                                         |
| `judge`        | Yes      | An `id` in `models.yaml`, or the name of the person who grades                                               |
| `labels`       | Yes      | 1 to 20 maps of `value`, `score` (0 to 1) and `description`. Lowercase values, with `-` or `_` between words |
| `passingScore` | Yes      | 0 to 1. A run passes when its label scores this or more                                                      |
| `samplingRate` | Yes      | A whole number from 0 to 100: the percent of runs that the scorer grades                                     |

## benchmark.md

```markdown
---
description: Compares Opus and Sonnet on the implement agent.
agent: implement
configs:
  - name: opus
    model: claude-opus-5-5
  - name: sonnet
    model: claude-sonnet-5-5
tasks:
  - name: cl-116-release-changeset
    commit: 25076894f5bbd0853aecf252d88d422aeef18352
    issue: .clutch/issues/CL-116.md
    check: mise exec -- bun test tools/check-changeset.test.ts
---

The suite measures how well each model builds a small issue.
```

| Key           | Required | Value                                                                  |
| ------------- | -------- | ---------------------------------------------------------------------- |
| `description` | Yes      | One line that says what the suite compares                             |
| `agent`       | Yes      | The name of a folder in `agents/`. Each run sends its prompt           |
| `configs`     | Yes      | 2 to 6 maps of `name` and `model`. `model` is an `id` in `models.yaml` |
| `tasks`       | Yes      | 1 to 20 maps of `name`, `commit`, `issue` and `check`. See below       |

| Task key | Value                                                                                     |
| -------- | ----------------------------------------------------------------------------------------- |
| `name`   | The name that the results and `--task` use                                                |
| `commit` | The full SHA of the commit that the task starts from                                      |
| `issue`  | The path of the issue file at `commit`, from the repository root. The agent gets its text |
| `check`  | The shell command that grades the result in the clone. Exit 0 passes                      |

`models.yaml` gives the harness of each config. `clutch bench <name>` runs the
suite and writes its results to `results/` in the suite folder. See the
[CLI reference](https://github.com/eggdev/clutch/blob/main/apps/cli/README.md#bench).

## models.yaml

```yaml
models:
  - id: claude-opus-5-5
    harness: claude
    where: Anthropic, through Claude Code
  - id: qwen3.8-27b
    harness: qwen
    where: The Spark, llama-swap at 127.0.0.1:8092
```

Each item has an `id` and a `harness`. `where` is optional: it says where the
model runs and how to reach it.

## Rules across files

The JSON Schema files cannot read a second file, so only the check applies
these rules:

- An agent's `runner` names a file in `runners/`.
- An agent's `model` is an `id` in `models.yaml`, and that model has the same
  `harness` as the agent.
- An automation's `agent` and each item of a scorer's `agents` name a folder
  in `agents/`.
- A scorer's `judge` is an `id` in `models.yaml`, or a lowercase kebab-case
  name of a person.
- A tree has at most 1 `foreman`.
- A scorer has at least 1 label that passes and 1 label that fails. No 2
  labels have the same `value`.
- No 2 items in `models.yaml` have the same `id`.
- A benchmark's `agent` names a folder in `agents/`, and each config's `model`
  is an `id` in `models.yaml`. No 2 configs have the same `name` or `model`,
  and no 2 tasks have the same `name`.

## JSON Schema files

Each kind has a JSON Schema (draft 2020-12) file. With these files, a
repository without Clutch can check the same keys:
[agent](https://github.com/eggdev/clutch/blob/main/apps/cli/schemas/factory/agent.schema.json),
[automation](https://github.com/eggdev/clutch/blob/main/apps/cli/schemas/factory/automation.schema.json),
[runner](https://github.com/eggdev/clutch/blob/main/apps/cli/schemas/factory/runner.schema.json),
[scorer](https://github.com/eggdev/clutch/blob/main/apps/cli/schemas/factory/scorer.schema.json),
[benchmark](https://github.com/eggdev/clutch/blob/main/apps/cli/schemas/factory/benchmark.schema.json)
and
[models](https://github.com/eggdev/clutch/blob/main/apps/cli/schemas/factory/models.schema.json).
A Markdown kind's schema checks the YAML between the `---` lines.

The schemas in code are the source.
`apps/cli/src/factory/schema-files.test.ts` fails when a JSON Schema file
differs from them.

## Add a key or a kind

1. Change the kind's file in `apps/cli/src/factory/`, such as `runner.ts`.
   A schema uses only the keywords in `json-schema.ts`. For a new kind, add a
   file, and add the kind to `kinds.ts` and `tree.ts`.
2. Add a rule across files to `references.ts`, when the key names another
   file.
3. Add a fixture or a test case to `check.test.ts`.
4. Write the JSON Schema files:
   `mise exec -- bun run clutch factory --write-schemas apps/cli/schemas/factory`.
5. Change this page.

## What to read when changing it

- `apps/cli/src/factory/`: one file for each kind, the loader and the rules
  across files.
- `apps/cli/src/factory-command.ts`: the command and where it finds the tree.
- [CLI reference](https://github.com/eggdev/clutch/blob/main/apps/cli/README.md#factory):
  the command's flags.
