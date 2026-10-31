# Ratchets / shrink-only baselines

A ratchet counts the violations of a rule in each file, and lets each count go down but never up.

## Why

Rank 27 of the researched practices. Almost two thirds of the leading repositories use it (63%). A rule that fails on every old violation is hard to turn on in a large codebase. A ratchet stops each added violation, so the total only goes down.

## Detection

`clutch doctor` reports this capability as present when two rules pass. `.clutch/ratchets.json` has a `ratchets` key that is not empty. A `package.json` or `project.json` defines the Nx target `check-ratchets`. It is partial when only one rule passes. It is also partial when a file in `packages/lint-rules/` mentions `ratchet` or `shrink-only`. See the `ratchets` entry in [the registry](./registry.yaml).

## Adopt

1. Add `.clutch/ratchets.json` with a `ratchets` object. Give each ratchet a name, a pattern or a command, a file glob and the count for each file.
2. Add a script that counts the violations and compares each count with the baseline. Make it fail when a count goes up.
3. Make the update step lower counts only. A higher count needs a person's review.
4. Add the root target `check-ratchets`, and run it in the canonical check command.
5. List the baseline as a guardrail file in `tools/guardrail-files.json`. Then run `mise exec -- bun tools/codeowners.ts --write`, so `.github/CODEOWNERS` names its owner.
6. Set `ratchets` to `adopted` in `clutch.yaml`.

## Waive

Set `ratchets` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when each rule is on everywhere with zero violations, so no baseline is necessary.
