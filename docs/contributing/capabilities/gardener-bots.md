# Scheduled gardener / maintenance agents

A gardener is an agent that runs on a schedule and opens one pull request with maintenance fixes.

## Why

Rank 51 of the researched practices. About one third of the leading repositories use it (33%). Docs, rules and checks drift as the code changes. A weekly agent pass finds the drift and fixes it in small steps.

## Detection

`clutch doctor` looks for a `gardening.yml` or `gardening.yaml` workflow in `.github/workflows/`, or for one workflow that triggers on `schedule` and uses `anthropics/claude-code-action`. With `--remote`, it also checks for the `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` Actions secret, since the agent cannot run without one. Without `--remote`, the capability is unknown. See the `gardener_bots` entry in [the registry](./registry.yaml).

## Adopt

1. Describe the gardening pass in a docs page. This repository uses [weekly gardening](../harness-engineering.md#weekly-gardening).
2. Add a scheduled workflow that runs an agent on that pass. See [`.github/workflows/gardening.yml`](../../../.github/workflows/gardening.yml).
3. Let the agent edit files only. Later steps in the workflow commit to a branch and open one pull request.
4. Never push to the default branch from the workflow.
5. Set `gardener_bots` to `adopted` in `clutch.yaml`.

## Waive

Set `gardener_bots` to `waived` in `clutch.yaml` with a reason. This capability is extra, so a gap only warns. A waiver is reasonable when a person does the same pass by hand on a schedule.
