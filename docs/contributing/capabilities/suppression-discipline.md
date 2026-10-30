# Lint-suppression discipline (reason required / no-disable)

Suppression discipline limits the comments that turn off a lint rule or a type check, so that each exception is visible.

## Why

Rank 19 of the researched practices. Almost two thirds of the leading repositories use it (63%). An agent that meets a lint error can silence it instead of fixing it. A check on suppression comments makes the fix the easy path.

## Detection

`clutch doctor` reports this capability as present when a `package.json` or `project.json` defines the Nx target `check-suppressions`. A `check-lint-suppressions` script in `.github/scripts/` also counts. See the `suppression_discipline` entry in [the registry](./registry.yaml).

## Adopt

1. Add a script that scans the source files for suppression comments. This repository uses [`tools/check-suppressions.ts`](../../../tools/check-suppressions.ts).
2. Add the root target `check-suppressions`, and run it in the canonical check command.
3. In this repository, `check-suppressions` rejects any comment such as `oxlint-disable` or `@ts-expect-error`. Fix the cause instead. The one exception is a Semgrep false positive: `nosemgrep: rule-id -- reason` names the rule and the reason, and the check rejects a `nosemgrep` without both. It also scans the scripts and workflows that Semgrep reads. See [CodeQL / SAST](./codeql-sast.md#silence-a-semgrep-false-positive).
4. To allow some suppressions, require a reason in each comment, and count the comments against a shrink-only baseline.
5. Set `suppression_discipline` to `adopted` in `clutch.yaml`.

## Waive

Set `suppression_discipline` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable for a repository with no linter and no type checker.
