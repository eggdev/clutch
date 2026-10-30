# Merge queue / merge trains

A merge queue tests each pull request on top of the ones ahead of it, then merges them in order.

## Why

Rank 73 of the researched practices. About half of the leading repositories use it (48%). Two pull requests can each pass alone and break together. With many agents, a queue keeps that break off the default branch.

## Detection

`clutch doctor` reports this capability as present when two rules pass. A workflow triggers on `merge_group`. The `merge_queue` remote probe passes. Doctor checks the remote probe on GitHub only with `--remote`. Without that flag, the probe is unknown, so a repository with only the trigger reports as partial. See the `merge_queue` entry in [the registry](./registry.yaml).

## Adopt

1. Add `merge_group` to the `on:` list of each workflow that runs a required check.
2. For a check that already ran on the pull request, such as agent review, skip the work and pass on `merge_group`.
3. On GitHub, turn on the merge queue in the default branch ruleset.
4. Run `mise exec -- bun run clutch doctor --remote` to confirm the result.
5. Set `merge_queue` to `adopted` in `clutch.yaml`.

## Waive

Set `merge_queue` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when few pull requests merge each day, so they rarely overlap.
