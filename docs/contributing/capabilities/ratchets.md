# Ratchets / shrink-only baselines

A ratchet counts the violations of a rule in each file, and lets each count go down but never up.

## Why

Rank 27 of the researched practices. Almost two thirds of the leading repositories use it (63%). A rule that fails on every old violation is hard to turn on in a large codebase. A ratchet stops each added violation, so the total only goes down.

## Detection

`clutch doctor` reports this capability as present when two rules pass. `.clutch/ratchets.json` has a `ratchets` key that is not empty. A `package.json` or `project.json` defines the Nx target `check-ratchets`. It is partial when only one rule passes. It is also partial when a file in `packages/lint-rules/` mentions `ratchet` or `shrink-only`. See the `ratchets` entry in [the registry](./registry.yaml).

## Adopt

A project from Clutch has the engine and the commands. See decision 0001 (CL-301).

1. Run `mise exec -- bun run clutch ratchet add <name> --pattern <regex> --files <glob>`. It writes the ratchet to `.clutch/ratchets.json` with today's count for each file. A `--command` that prints `path:count` lines works instead of a pattern, such as for lint output.
2. `clutch ratchet check` fails when a count goes up, against the baseline or against the merge base for a file the change touches. It exits 2 when a count went down and the baseline did not.
3. `clutch ratchet update` lowers the baseline to the counts today. It refuses a higher count.
4. Add the root target `check-ratchets` (`bun tools/clutch.ts ratchet check`), and run it in the canonical check command.
5. List the baseline as a guardrail file in `tools/guardrail-files.json`. Then run `mise exec -- bun tools/codeowners.ts --write`, so `.github/CODEOWNERS` names its owner.
6. Set `ratchets` to `adopted` in `clutch.yaml`.

## Waive

Set `ratchets` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when each rule is on everywhere with zero violations, so no baseline is necessary.
