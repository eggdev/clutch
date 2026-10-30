# PR size limits / size labels

PR size limits label each pull request by its changed lines, and warn or fail above a threshold.

## Why

Rank 69 of the researched practices. About one in five of the leading repositories use it (19%). A small pull request is faster to review and safer to revert. In the research, the median pull request of the leading repositories has about 100 changed lines.

## Detection

`clutch doctor` reports this capability as present when a workflow file mentions `pr-size` or `size/XL`, or `clutch.yaml` has a `pr_size` key. See the `pr_size_limits` entry in [the registry](./registry.yaml).

## Adopt

1. Count the added and deleted lines with `git diff --numstat` against the merge base.
2. Skip lockfiles, snapshots and generated files.
3. Set a warning threshold and a failure threshold, such as 300 and 800 lines.
4. Add a CI job on `pull_request` that sets one label: `size/S`, `size/M`, `size/L` or `size/XL`.
5. Let only the owner apply an exemption label, such as `size/exempt`.
6. Set `pr_size_limits` to `adopted` in `clutch.yaml`.

## Waive

Set `pr_size_limits` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when most changes are generated updates, such as in a data mirror.
