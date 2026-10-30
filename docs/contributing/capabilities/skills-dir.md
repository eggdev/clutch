# Agent skills directory

An agent skills directory holds the instructions for recurring tasks, with one `SKILL.md` file for each skill.

## Why

Rank 8 of the researched practices. About four in five of the leading repositories use it (81%). A skill holds the steps for one recurring task, such as delivery or verification. The agent loads a skill only when the task matches, so the root context stays small.

## Detection

`clutch doctor` reports this capability as present when git tracks a file that matches `.agents/skills/*/SKILL.md` or `.claude/skills/*/SKILL.md`. See the `skills_dir` entry in [the registry](./registry.yaml).

## Adopt

1. Add one folder for each skill in `.agents/skills/`. This repository has skills such as [verify](../../../.agents/skills/verify/SKILL.md) and [deliver](../../../.agents/skills/deliver/SKILL.md).
2. Write a `SKILL.md` file in each folder. Give it a name and a description in its frontmatter. The description says when the skill applies.
3. Read the [skills README](../../../.agents/skills/README.md) for the layout and the conventions.
4. Set `skills_dir` to `adopted` in `clutch.yaml`.

## Waive

Set `skills_dir` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when agents do no recurring task in the repository.
