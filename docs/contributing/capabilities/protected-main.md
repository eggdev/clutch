# Protected default branch (PR-only, required checks)

A protected default branch takes changes only through pull requests that pass the required checks.

## Why

Clutch adds this practice, so it has no rank in the research data. When many agents work in parallel, one direct push can break every branch. Branch rules make the checks a gate, not advice.

## Detection

`clutch doctor` reports this capability as present when the `protected_main` remote probe passes. Doctor checks the probe on GitHub only with `--remote`. Without that flag, it reports the capability as unknown. See the `protected_main` entry in [the registry](./registry.yaml).

## Adopt

Keep the ruleset in `.github/rulesets/main.json`, so a change to branch
protection is a reviewed change to a file. Sync manages the file, so a new
required check reaches each project. This repository's file is the example.

1. Require a pull request before each merge. Dismiss stale approvals after a
   push. Require 0 approvals, and require code owner review
   (`require_code_owner_review: true`). Then only a pull request that changes
   a path in `.github/CODEOWNERS`, the one-way-door paths, waits for the
   owner's approval. The release bot opens agent pull requests, so the owner
   can approve them. See
   [approval](../../../.agents/skills/deliver/references/pull-requests.md#approval).
2. Allow merge commits only, so the rule matches `bun run pr merge`.
3. Require the status checks that run the canonical check command. This
   repository requires `validate`, `journeys`, `secrets` and `commits`, plus
   `sast` (see [CodeQL / SAST](./codeql-sast.md)) and `agent-review` (see
   [review](../review.md)). Pin each one to the GitHub Actions app with
   `"integration_id": 15368`. Then a check run with the same name from another
   app, or from a token with `checks: write`, cannot pass the rule. Auto-merge
   counts only those runs too.
4. Block force pushes and branch deletion.
5. Add bypass actors. The release bot bypasses always, so the release commit
   can reach the default branch. See [releases](../setup/releases.md#the-release-bot).
   The repository admin bypasses for pull requests only. A person can then
   merge a fix while a required check is down, but nobody pushes to the
   default branch directly. The bot's `actor_id` is `vars.CLUTCH_APP_ID`, the
   repository variable that holds the app id, so one file fits each project.
6. Run `mise exec -- bun run clutch ruleset --apply`. It creates each ruleset
   in `.github/rulesets/`, or updates the one with the same name with PUT.
   Run it again after each change to a file. Without `--apply`, it only
   compares the files with GitHub, and exits 2 when one differs.
7. Run `mise exec -- bun run clutch doctor --remote` to confirm the result. It
   prints how each ruleset file compares with GitHub, and `--check` fails when
   one differs.
8. Set `protected_main` to `adopted` in `clutch.yaml`.

## Waive

Set `protected_main` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable for a personal scratch repository, or for a repository on a host other than GitHub.
