# Clutch plan

This page says what each phase means and why the issues sit where they do. The
issue files in `issues/` are the source of truth for each task. `clutch issues
next` takes issues in phase order, then id order. An issue keeps its id when it
moves to another phase.

Re-sequenced on 2026-10-30 (CL-040). Brendan approved the order and the
decisions below.

## Where Clutch stands

P0 built the platform: the tracker, the CLI shipped through mise, the
capability registry and `doctor`, sync with lineage, a release on every merge,
and 26 `check-*` invariant scripts in `validate`. On invariants, Clutch is
ahead of most repositories in the research.

The gap is the layers that let the factory run without its owner:

- **Delegated merge.** Every PR still lands because Brendan says so.
- **Measurement.** No number says whether a change to the factory helped.
- **Learning loops.** Failures and friction do not turn into checks by themselves.

## The evidence behind the order

The plan follows a study of 75 repositories that ship with agents. It scored
each capability on raw merges per day and on how much more a repository ships
than its headcount predicts. The study is correlational, not causal. The
numbers that set the order:

- **Risk-tiered auto-merge** had the strongest link to throughput of all 110
  capabilities, at every team size.
- **Ratchets, a scoped local check, flake hunters and CI failure explainers**
  were positive at every team size.
- **Among teams of 13 or more**, the repositories that ship more than their
  headcount predicts automate the merge side. They add few gates on what comes
  in. The ones that ship less do the opposite. Learning loops are the largest
  gap between the two groups.
- **A merge queue and a PR size limit** had no link to throughput at any team
  size.
- **Ownership, labels, test impact and deprecation policy** grow with team
  size. They matter once a project has several engineers.

## Phases

| Phase | Means                                      | Exit metric                                                                                           |
| ----- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| P0    | The platform. Done.                        | Doctor reports only capabilities that run. The tracker matches GitHub.                                |
| P1    | Measure, and prepare delegated merge.      | Flow metrics have a baseline. The auto-merge dry-run matches Brendan on 20 PRs in a row.              |
| P2    | Turn on delegated merge.                   | Half or more of the PRs merge with no human action. Reverts stay under 2%.                            |
| P3    | Fast checks and parallel lanes.            | The local check meets its measured budget. Three or more lanes run at once without collisions.        |
| P4    | Learning loops.                            | Main-red minutes and flaky reruns go down. Friction turns into at least one new check a month.        |
| P5    | Platform contracts, and ready for a team.  | No break reaches a project without a warning release. A new engineer keeps merges per engineer level. |
| later | Backlog, or work that waits for a trigger. | The issue names its trigger.                                                                          |

### P1: measure, and prepare delegated merge

- Measure: CL-503 (flow metrics, from trailers and the GitHub API).
- Route: CL-109 (labels), CL-403 (risk tiers by path), CL-401 (size label and warning).
- Delegate: CL-404 (auto-merge dry-run), CL-110 (revert by label), CL-111 (PR babysitter skill).
- Trust floor: CL-102 to CL-107, including CL-106, Brendan's settings gate.
- Flaky CI: CL-107 and CL-903, since a flaky check blocks auto-merge.

### P2: turn on delegated merge

CL-308 makes agent review and CodeQL required. CL-405 turns auto-merge on in
three steps: bot PRs, then `risk/low`, then `risk/medium` with a clean
agent review. CL-503b adds PR size and agent share to the metrics.

### P3: fast checks and parallel lanes

CL-204 and CL-303 (changed scope, locally and in CI), CL-201 to CL-203
(worktrees, per-worktree env, ports and DB, a cloud environment), CL-205 (MCP
config), and CL-309 and CL-310 (test hygiene).

### P4: learning loops

CL-305 (CI failure explainer), CL-304 and CL-502 (quarantine and flake
hunter), CL-306 and CL-501 (friction log into gardening, which turns repeated
friction into checks), CL-301 to CL-302b (ratchets), CL-108 (the daily
security agent) and CL-505 (accessibility in journeys).

### P5: platform contracts, and ready for a team

CL-506 to CL-508 (a snapshot of the Clutch surface, a deprecation policy, and
migrations that sync runs), CL-509 (registry v2), CL-510 (generated
CODEOWNERS and merges by area owners), CL-307 and CL-511 (nested agent rules
and a budget for the whole chain), and CL-504 (a weekly cross-repository
digest).

### Downstream

CL-605 (survey Neighborhood's strengths) and CL-701 (Bar Savvy in doctor mode)
can start now. Neighborhood adoption (CL-602 to CL-604) is best after P2, so a
project gets delegated merge from its first sync.

## Decisions

Brendan, 2026-10-30:

1. Workflows that spend the Anthropic credential run the cheapest model by
   default (CL-037).
2. Releases push to a protected `main` with a GitHub App token (CL-039).
3. A PR's last commit marks its issue `done`, and the merge makes it true
   (CL-036).
4. The merge queue leaves the auto-merge gate and waits for its trigger
   (CL-906). PR size is a label and a warning, never a failure (CL-401).
5. Once agent review is a required check, a missing credential fails it in
   Clutch. Projects keep pass-with-notice until they adopt it (CL-308).
