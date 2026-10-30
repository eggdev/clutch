# PR size limits / size labels

PR size limits label each pull request by its changed lines, and warn above a threshold.

## Why

Rank 69 of the researched practices. About one in five of the leading repositories use it (19%). A small pull request is faster to review and safer to revert. In the research, the median pull request of the leading repositories has about 100 changed lines.

## Detection

`clutch doctor` reports this capability as present when a workflow file mentions `pr-size` or `size/XL`, or `clutch.yaml` has a `pr_size` key. See the `pr_size_limits` entry in [the registry](./registry.yaml).

## Adopt

`clutch labels` counts the added and deleted lines against the merge base. It
skips lockfiles, snapshots and `.clutch/`, plus the globs in `pr_size.exclude`.
It gives one label: `size/S` (up to 100 lines), `size/M` (300), `size/L` (800)
or `size/XL`. The Labels workflow sets it on each pull request.

1. Add `pr_size` to `clutch.yaml`, such as `pr_size: { warn: 300, exclude: [] }`.
2. Above `warn`, the workflow adds a warning to the run. Size never fails a
   pull request: in the research, size had no link to throughput.
3. Set `pr_size_limits` to `adopted` in `clutch.yaml`.

## Waive

Set `pr_size_limits` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when most changes are generated updates, such as in a data mirror.
