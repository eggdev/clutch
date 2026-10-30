# CodeQL / SAST

Static application security testing (SAST), such as CodeQL, scans the source code for security flaws on each change.

## Why

Rank 16 of the researched practices. About two thirds of the leading repositories use it (67%). Agents write a lot of code, and a reviewer can miss an injection or an unsafe pattern. A SAST scan finds known flaw patterns in each change.

## Detection

`clutch doctor` reports this capability as present when a workflow uses `github/codeql-action/`, or the `code_scanning_default_setup` remote probe passes. Doctor checks the remote probe on GitHub only with `--remote`. Without that flag, the probe is unknown and the workflow rule decides. See the `codeql_sast` entry in [the registry](./registry.yaml).

## Adopt

1. Add a workflow file `codeql.yml` in `.github/workflows/`.
2. Run it on each pull request, on each push to the default branch and on a weekly schedule.
3. Use the `init` and `analyze` actions of `github/codeql-action`. Pin each action to a full commit SHA.
4. Grant `contents: read` at the top level. Grant `security-events: write` to the job only.
5. List each language of the repository, such as `javascript-typescript` and `actions`.
6. As an alternative, turn on CodeQL default setup in the code security settings on GitHub. Pick one: GitHub refuses the workflow's results while default setup is on.
7. Set `codeql_sast` to `adopted` in `clutch.yaml`.

## Waive

Set `codeql_sast` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when another SAST tool runs in CI. Name that tool in the reason.
