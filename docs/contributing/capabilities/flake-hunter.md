# Flake hunters / test audit loops

A flake hunter is a scheduled workflow that runs the tests many times to find the ones that pass and fail at random.

## Why

Rank 26 of the researched practices. About one third of the leading repositories use it (33%). A flaky test shows up rarely on any one pull request. Repeated runs on a schedule find it before it blocks a person or an agent.

## Detection

`clutch doctor` reports this capability as present when one workflow triggers on `schedule` and runs a command that matches `rerun-each`, `repeat-each` or `flake`. A schedule alone does not count. See the `flake_hunter` entry in [the registry](./registry.yaml).

## Adopt

1. Add a workflow file `flake-hunt.yml` in `.github/workflows/`, with a nightly `schedule` trigger.
2. Run the tests with a repeat flag, such as `bun test --rerun-each 20` or `playwright test --repeat-each 20`.
3. Report each test that passes on some runs and not on others. Open an issue, or add the test to the [flaky-test quarantine](./flaky-quarantine.md).
4. Grant the job only the permissions it needs.
5. Set `flake_hunter` to `adopted` in `clutch.yaml`.

## Waive

Set `flake_hunter` to `waived` in `clutch.yaml` with a reason. This capability is extra, so a gap only warns. A waiver is reasonable when the test suite is small and has no shared state.
