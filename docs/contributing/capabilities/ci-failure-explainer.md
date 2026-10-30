# CI failure explainer / investigation agent

A CI failure explainer is an agent that reads the logs of a failed CI run and comments with the cause and the fix.

## Why

Rank 63 of the researched practices. More than one third of the leading repositories use it (37%). A failed run often hides its cause in a long log. A short comment with the failed step and the fix command saves each author that search.

## Detection

`clutch doctor` reports this capability as present when two rules pass. A workflow triggers on `workflow_run` and a step of it reads the failed log or the conclusion. A workflow file mentions `log-failed`, or tests whether a conclusion is `failure`. It is partial when only one rule passes. See the `ci_failure_explainer` entry in [the registry](./registry.yaml).

## Adopt

1. Add a workflow file `ci-explain.yml` in `.github/workflows/`.
2. Trigger it on `workflow_run` of the CI workflow, with the type `completed`. Run the job only for a failed run from a pull request in this repository.
3. Grant `contents: read` at the top level. Grant `pull-requests: write` and `actions: read` to the job.
4. Download the failed logs with `gh run view --log-failed`, and trim them.
5. Pass the logs to `anthropics/claude-code-action` with a prompt that asks for a short answer.
6. When no API secret exists, pass with a notice, like the agent review workflow.
7. Set `ci_failure_explainer` to `adopted` in `clutch.yaml`.

## Waive

Set `ci_failure_explainer` to `waived` in `clutch.yaml` with a reason. This capability is extra, so a gap only warns. A waiver is reasonable when CI failures are rare and their logs are short.
