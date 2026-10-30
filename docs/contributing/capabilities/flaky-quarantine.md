# Flaky-test quarantine / registry

A flaky-test quarantine lists each unreliable test with an issue and an expiry date, so that the test leaves the gate in the open.

## Why

Rank 46 of the researched practices. About half of the leading repositories use it (52%). A flaky test teaches agents and people to run CI again until it passes. A registry takes the test out of the gate in the open, and the expiry date forces a fix.

## Detection

`clutch doctor` reports this capability as present when git tracks `flaky-tests.json` in `tools/`, or `.clutch/flaky.json`. See the `flaky_quarantine` entry in [the registry](./registry.yaml).

## Adopt

1. Add a registry file, such as `flaky-tests.json` in `tools/`. Give each entry the file, the test name, an issue and an expiry date.
2. List the registry as a guardrail file, with an owner in `.github/CODEOWNERS`.
3. Add a root target that fails on an expired entry, or on an entry with no issue. Run it in the canonical check command.
4. Run the quarantined tests in a separate, optional CI step. Retry each one, and report the result.
5. Set `flaky_quarantine` to `adopted` in `clutch.yaml`.

## Waive

Set `flaky_quarantine` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when the test suite has no flaky tests, such as a suite of unit tests only.
