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

It reports the [factory numbers](#factory-numbers) first. Then it reports these numbers for the pull requests merged in the window:

- Merged PRs, and merged PRs per day.
- The share merged with no human action (`noHumanAction`). It is not autonomy: a review, a comment or the merge by a person counts as an action here. A person acts when a `User` account merges the PR, enables auto-merge, requests or submits a review, or comments. An agent that merges with a person's token counts as that person.
- The merges with no human action by auto-merge step (`noHumanAction.byStep`): `bots`, `low`, `medium` or `unattributed`, the steps of CL-405. A bot comment with `<!-- automerge-enabled:<step>:<sha> -->` decides the step, and `marked` counts those. Without the marker, a bot author or a `renovate/` or `gardening/` branch is `bots`, and the `risk/low` or `risk/medium` label gives the tier step.
- The hours from open to merge, and from the last passing check on the head commit to merge, as p50 and p90.
- Main-red minutes: the time a required check of the default branch was failing. Main turns red when a required check concludes as a failure on a first-parent commit. It turns green when the latest run of each required check on that commit, or a later one, passes.
- Reverts: merged PRs whose title starts with `Revert`, as a rate of the merged PRs, and revert commits on the default branch. A revert with the `drill` label is a rehearsal. It is not counted here. `drills` counts it apart, and its merge commit is left out of the commits.
- Agent share: the PRs and commits with a `Co-authored-by` trailer that names Claude, Codex, Cursor or Copilot. `agents.branch` also counts the PRs whose head branch starts with `pr.branchPrefix` from `clutch.yaml`, `clutch/cl-` by default. The release bot or the operator opens each agent PR, so the branch tells an agent apart, not the author.
- PR size (`prSize`): the changed lines of each merged PR as p50 and p90, and the count of each `size/` label. It counts as `clutch labels` does: lockfiles, snapshots, `.clutch/` and the checkout's `pr_size.exclude` do not count.
- CI: the completed workflow runs, their failure rate, and their p50 and p90 duration.
- Issues done: the `.clutch/issues` set to `done` by a PR merged in the window. It is counted only for the checkout, so `--repo` for another repository leaves it null.
- Dry-run agreement: the auto-merge dry-run verdicts commented in the window, from the `<!-- automerge-dry-run:` marker. A 👎 on a verdict is a disagreement, and a 👍 alone is an agreement. `streak` counts the agreements since the latest disagreement and skips unanswered verdicts. P1 ends at a streak of 20, so widen `--since` to reach that far back. Only the owner's reactions count. The grades that the retired Grade verdicts workflow's bot gave in the window also count. The owner is `--owner`, then `automerge.owner` in `clutch.yaml`, then the default owner in CODEOWNERS. With no owner, no reaction counts, and `unavailable.verdictOwner` says so. `--verdicts` lists the ungraded verdicts, the disagreed ones and the streak.
- Watch: what needs a look, in one row. It flags a no-human-action share under 80% and a revert rate over 2%, the P2 exit in `.clutch/PLAN.md`. It also names the main-red minutes and each open `risk-tighten` issue. The Revert workflow files a `risk-tighten` issue when it reverts a PR that auto-merge merged. See [tighten after a revert](../operations/rollback.md#tighten-after-a-revert). The weekly digest prints the row for each repository.

`--json` prints the same report for a digest. A field that GitHub does not answer is null, and `unavailable` names the reason. A reader ignores fields it does not know, so later releases can add fields.

## Factory numbers

The factory numbers use Warp's definitions from layer 04 of [C-Suite's factory stack](https://github.com/eggdev/c-suite/blob/main/docs/stack.md#04-improvement). C-Suite's weekly metrics brief reads them for each project:

```sh
clutch metrics --repo eggdev/neighborhood --since 14d --json | jq .factory
```

`factory.definitions` is the version of the rules below, now `warp-2026-11-04`. A change to a rule that changes a number gets a new version, so a reader can pin the meaning. Each number counts the PRs merged in the window. The window ends at the time of the run.

- **Autonomy** (`factory.autonomy`): the share of merged PRs with no human code push before the merge. `humanPushed` lists the PRs with a push.
- **Cycle time** (`factory.cycleTimeHours`): p50 and p90 of the hours from the lane start to 3 events. They are the PR (`toPr`), the first review (`toFirstReview`) and the merge (`toMerge`). `count` is the number of PRs in each. A PR with no review is left out of `toFirstReview`.
- **Reverts** (`factory.reverts`): the share of merged PRs that a later merged PR reverts. `pulls` lists the reverted PRs. `overBrake` is true when the rate is more than 2%. No gate reads it.

`factory.pulls` has one row for each PR. A row gives the lane start, the time the PR opened, its first review and its merge. It also says whether the PR had a human push and whether a later PR reverted it. A reader can check each number from these rows, or put its own lane start in their place.

GitHub does not record each idea in Warp's definitions. Where the data does not agree with a definition, the code uses these rules:

- **A human code push** is a commit on the PR that has no agent `Co-authored-by` trailer and no bot author. These commits are not human pushes:
  - A merge commit with 2 parents, such as the "Update branch" button. It brings in the base branch and adds no code.
  - The commits that `pr open` and `pr ready` make: `chore(changeset): add a <bump> changeset for this PR` and `chore(tracker): mark <id> done`. Older releases made them with no trailer.
  - A commit by a bot, such as Renovate or the Revert workflow.
- **Opening the PR** counts as a push when a person opened it. The operator's token or the release bot opens each agent PR, so the PR author does not tell a person from an agent. A person opened the PR when its branch does not start with `pr.branchPrefix`, and its first commit has no agent trailer and no bot author. `--repo` for another repository uses the default prefix, `clutch/cl-`.
- **An agent commit with no trailer** counts as a human push. Agent commits from before the trailer rule count this way too.
- **The lane start** is the earlier of 2 times. One is the author date of the PR's first commit. The other is the author date of the latest commit on the default branch that set `status: in_progress` in `.clutch/issues/<id>.md`, before the first commit. The id comes from the `(ID)` at the end of the PR title, else from the branch name. A PR with no issue file uses the first commit. A rebase keeps author dates. When an agent makes its commits only at the end of its work, the lane start is late, and `toPr` is near 0.
- **The first review** is the earliest of 2 times. One is the first review that anyone submits, a bot included, such as agent review's findings or a code scanning review. The other is the first run of the Agent review workflow, `agent-review.yml`, on a commit of the PR. The run must complete with `success`, `failure` or `neutral`, and its end is its `updated_at`. Agent review with no findings submits no review, so the run counts. A cancelled run does not count. A run that passes with the notice for a missing credential reviews nothing, but it counts, since the run list does not tell it apart. When the repository has no such workflow, `unavailable.agentReview` says so, and only submitted reviews count.
- **A revert** names its target in one of these ways:
  - The `revert/<n>` branch of the Revert workflow.
  - `Reverts #<n>` or `Reverts <owner>/<repo>#<n>` in its body or a commit.
  - `This reverts commit <sha>` from `git revert`, with the merge commit or a commit of the target.
  - The title `Revert "<title>"` from GitHub's button, or `revert: <title>` from the Revert workflow.

  The revert must merge after its target. It must also look like a revert: a `revert/` branch, or a title or commit that starts with `Revert`. A PR with the `drill` label is a rehearsal. It does not count as a revert or as a reverted PR. The `reverts.rate` above counts the revert PRs. The factory rate counts the PRs that they revert, so the 2 rates can differ.

- **Times** are in hours, rounded to 0.1. A time before the lane start, such as a PR opened before its first commit by a clock out of step, counts as 0.

For the factory numbers, the report reads one list of the Agent review runs in the window. For each PR, it also reads the commits that touched its issue file. It then reads the detail of each such commit from before the first commit of the PR. A run of 14 days on 172 PRs sent 1,730 GET requests, and one on 50 PRs sent 432. The GitHub limit is 5,000 an hour for each token.

## Weekly digest

`.github/workflows/weekly-digest.yml` runs every Monday, and from the Actions
tab. For each repository in `fleet` in `clutch.yaml`, it checks the repository
out at its `ref` and writes `clutch doctor --remote` and `clutch metrics` to the
job summary. Then it adds a contact sheet of the screenshots that changed.

The contact sheet is `tools/journeys/visual-digest.ts`. A screenshot baseline
is a PNG in a `__screenshots__` folder, named
`<snap>-<mobile|desktop>-<light|dark>.png`. The sheet lists each one that
changed on the branch in the last 7 days, before and after, with the commit
that changed it. The owner sees each visual change of the week on one page, so
no single PR needs the owner for its pictures. A repository with no such PNG
gets the line "No screenshot baseline changed." The sheet reads the history of
the checkout, which the job fetches with no file contents, so it makes no API
call.

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
