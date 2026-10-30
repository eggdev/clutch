# Protected default branch (PR-only, required checks)

A protected default branch takes changes only through pull requests that pass the required checks.

## Why

Clutch adds this practice, so it has no rank in the research data. When many agents work in parallel, one direct push can break every branch. Branch rules make the checks a gate, not advice.

## Detection

`clutch doctor` reports this capability as present when the `protected_main` remote probe passes. Doctor checks the probe on GitHub only with `--remote`. Without that flag, it reports the capability as unknown. See the `protected_main` entry in [the registry](./registry.yaml).

## Adopt

Keep the ruleset in `.github/rulesets/main.json`, so a change to branch
protection is a reviewed change to a file. This repository's file is the
example.

1. Require a pull request before each merge. Dismiss stale approvals after a
   push. With one maintainer, require 0 approvals, because nobody can approve
   their own pull request.
2. Allow merge commits only, so the rule matches `bun run pr merge`.
3. Require the status checks that run the canonical check command. This
   repository requires `validate`, `journeys`, `secrets` and `commits`.
4. Block force pushes and branch deletion.
5. Add bypass actors. The release bot bypasses always, so the release commit
   can reach the default branch. See [releases](../setup/releases.md#the-release-bot).
   The repository admin bypasses for pull requests only. A person can then
   merge a fix while a required check is down, but nobody pushes to the
   default branch directly.
6. Create the ruleset with
   `gh api -X POST repos/<owner>/<repo>/rulesets --input .github/rulesets/main.json`.
   To change it later, edit the file and send it with `-X PUT` to the ruleset
   id.
7. Run `mise exec -- bun run clutch doctor --remote` to confirm the result.
8. Set `protected_main` to `adopted` in `clutch.yaml`.

## Waive

Set `protected_main` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable for a personal scratch repository, or for a repository on a host other than GitHub.
