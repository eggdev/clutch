# Factory telemetry (agent spend, CI timing, quality signals)

Factory telemetry records the cost and the results of the agent workflow, such as agent spend, CI time and review findings.

## Why

Rank 28 of the researched practices. More than two in five of the leading repositories use it (44%). Without numbers, a team cannot tell whether a guardrail helps or slows the work. Telemetry shows where the time and the money go.

## Detection

`clutch doctor` reports this capability as present when a workflow file runs `clutch metrics`, or git tracks `.clutch/metrics.yaml`. See the `factory_observability` entry in [the registry](./registry.yaml).

## Adopt

1. Pick the signals. Examples are agent spend for each pull request, CI time for each job, the count of flaky tests and the review findings.
2. Define each signal in `.clutch/metrics.yaml`.
3. Collect the signals in a scheduled workflow. Read the CI timing from the GitHub Actions API, and the spend from the agent provider.
4. Publish a short report, such as a weekly issue or a dashboard.
5. Set `factory_observability` to `adopted` in `clutch.yaml`.

## Waive

Set `factory_observability` to `waived` in `clutch.yaml` with a reason. This capability is extra, so a gap only warns. A waiver is reasonable for a small repository where the owner sees the costs directly.
