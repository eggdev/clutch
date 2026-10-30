# PR template

A PR template is the default body of each pull request, with the sections that a reviewer needs.

## Why

Rank 2 of the researched practices. More than nine in ten of the leading repositories use it (93%). A template makes an agent state the change, the reason and the proof in a fixed shape. Reviewers then find the same facts in the same place.

## Detection

`clutch doctor` reports this capability as present when git tracks `.github/pull_request_template.md`, or a Markdown file in `.github/PULL_REQUEST_TEMPLATE/`. See the `pr_template` entry in [the registry](./registry.yaml).

## Adopt

1. Add `.github/pull_request_template.md`. The [template](../../../.github/pull_request_template.md) of this repository is an example.
2. Ask for the summary, the reason, the verification evidence and the risk.
3. Keep the template short, so that each author fills in each section.
4. Set `pr_template` to `adopted` in `clutch.yaml`.

## Waive

Set `pr_template` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when the repository takes no pull requests, such as a mirror.
