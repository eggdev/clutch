# Factory telemetry (agent spend, CI timing, quality signals)

Factory telemetry records the cost and the results of the agent workflow, such as agent spend, CI time and review findings.

## Why

Rank 28 of the researched practices. More than two in five of the leading repositories use it (44%). Without numbers, a team cannot tell whether a guardrail helps or slows the work. Telemetry shows where the time and the money go.

## Detection

`clutch doctor` reports this capability as present when a workflow file runs `clutch metrics`, or git tracks `.clutch/metrics-baseline.json`. See the `factory_observability` entry in [the registry](./registry.yaml).

## Measure

`clutch metrics` reads the repository through `gh api` GET requests only, so it needs a signed-in `gh` and changes nothing. It runs from a Clutch clone and from the release binary, in any project. `--repo OWNER/NAME` reads another repository, and `--since 30d` widens the window from the default 14 days.

```sh
mise exec -- bun run clutch metrics
mise exec -- bun run clutch metrics --since 30d --json
```

It reports these numbers for the pull requests merged in the window:

- Merged PRs, and merged PRs per day.
- The share merged with no human action. A person acts when a `User` account merges the PR, enables auto-merge, requests or submits a review, or comments. An agent that merges with a person's token counts as that person.
- The merges with no human action by auto-merge step (`noHumanAction.byStep`): `bots`, `low`, `medium` or `unattributed`, the steps of CL-405. A bot comment with `<!-- automerge-enabled:<step>:<sha> -->` decides the step, and `marked` counts those. Without the marker, a bot author or a `renovate/` or `gardening/` branch is `bots`, and the `risk/low` or `risk/medium` label gives the tier step.
- The hours from open to merge, and from the last passing check on the head commit to merge, as p50 and p90.
- Main-red minutes: the time a required check of the default branch was failing. Main turns red when a required check concludes as a failure on a first-parent commit. It turns green when the latest run of each required check on that commit, or a later one, passes.
- Reverts: merged PRs whose title starts with `Revert`, as a rate of the merged PRs, and revert commits on the default branch.
- Agent share: the PRs and commits with a `Co-authored-by` trailer that names Claude, Codex, Cursor or Copilot. `agents.branch` also counts the PRs whose head branch starts with `pr.branchPrefix` from `clutch.yaml`, `clutch/cl-` by default. The release bot or the operator opens each agent PR, so the branch tells an agent apart, not the author.
- PR size (`prSize`): the changed lines of each merged PR as p50 and p90, and the count of each `size/` label. It counts as `clutch labels` does: lockfiles, snapshots, `.clutch/` and the checkout's `pr_size.exclude` do not count.
- CI: the completed workflow runs, their failure rate, and their p50 and p90 duration.
- Issues done: the `.clutch/issues` set to `done` by a PR merged in the window. It is counted only for the checkout, so `--repo` for another repository leaves it null.
- Dry-run agreement: the auto-merge dry-run verdicts commented in the window, from the `<!-- automerge-dry-run:` marker. A 👎 on a verdict is a disagreement, and a 👍 alone is an agreement. `streak` counts the agreements since the latest disagreement and skips unanswered verdicts. P1 ends at a streak of 20, so widen `--since` to reach that far back. Only the owner's reactions count, and those of the grading bot that the Grade verdicts workflow names. The owner is `--owner`, then `automerge.owner` in `clutch.yaml`, then the default owner in CODEOWNERS. With no owner, no reaction counts, and `unavailable.verdictOwner` says so. `--verdicts` lists the ungraded verdicts, the disagreed ones and the streak.

`--json` prints the same report for a digest. A field that GitHub does not answer is null, and `unavailable` names the reason. A reader ignores fields it does not know, so later releases can add fields.

## Weekly digest

`.github/workflows/weekly-digest.yml` runs every Monday, and from the Actions
tab. For each repository in `fleet` in `clutch.yaml`, it checks the repository
out at its `ref` and writes `clutch doctor --remote` and `clutch metrics` to the
job summary.

```yaml
fleet:
  - repo: eggdev/neighborhood # owner/name
    ref: main # the branch to read
```

The release bot reads each repository, so no personal token is needed. Each
job mints an installation token for one repository, with Contents, Metadata,
Administration, Actions and Pull requests, each read only. The bot's key sits
in the `release` environment, which only the default branch may use. See
[the release bot](../setup/releases.md#the-release-bot).

To add a repository:

1. Give the bot those five read permissions in its app settings, if it lacks
   any. Each account that installed it then accepts the change.
2. Install the bot on the repository. A repository in another account, such
   as an organization, needs the app to be installable by any account, under
   "Make public" in its settings. That lets other accounts install it. It gives
   nobody access to your own repositories.
3. Add the repository to `fleet`.

A repository that the bot cannot read is skipped with a notice in the
summary. Without the bot or without `fleet`, the run passes with a notice.

## Adopt

1. Run `mise exec -- bun run clutch metrics --json | jq . > .clutch/metrics-baseline.json` and commit it, so later changes have a number to beat.
2. Run `clutch metrics` on a schedule, such as a weekly workflow that writes it to the job summary.
3. Set `factory_observability` to `adopted` in `clutch.yaml`.

## Waive

Set `factory_observability` to `waived` in `clutch.yaml` with a reason. This capability is extra, so a gap only warns. A waiver is reasonable for a small repository where the owner sees the costs directly.
