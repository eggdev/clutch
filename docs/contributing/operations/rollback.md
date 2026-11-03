# Rollback

What to do when a deploy breaks production. When stored data is wrong, a code
rollback does not fix it. Use the data recovery runbook from the
[operations map](./index.md).

## 1. Decide fast

Find the bad commit SHA. The deploy log, the error tracker release and the
health endpoint each show it.

| Symptom                                    | First action                                      |
| ------------------------------------------ | ------------------------------------------------- |
| Health check fails on one service          | Path A on that service, if the safety checks pass |
| Errors rise after a deploy, health is good | Compare the release SHA and the health SHA        |
| Only the UI is bad                         | Path A on the web service                         |
| The deploy changed stored data or a secret | Path B                                            |

<!-- kickoff: Replace the rows with the symptoms for this deployment. Name each service and the health URL that shows its SHA. -->

## 2. Choose the path

| Path                 | What it does                                           | Time         |
| -------------------- | ------------------------------------------------------ | ------------ |
| A: platform rollback | The host serves a version it already stores            | Minutes      |
| B: forward fix       | A revert or fix PR merges and the deploy workflow runs | One CI cycle |

Path A is safe only when all of these are true:

- Each migration in the bad deploy is additive: a new table, a new nullable
  column or a new index. The old code ignores it.
- No secret rotated in the same window. Old code with a new key can end all
  sessions or make encrypted data unreadable.
- The host can restore the version. Some hosts refuse a rollback across a
  storage or binding change.

If one is false, use Path B. Migrations only move forward. See
[two-way and one-way doors](../../principles/two-way-doors.md).

## 3. Path A: platform rollback

1. Freeze merges to the main branch. A new merge queues a deploy that replaces
   the rollback.
2. Never cancel a running deploy. A cancel can stop between a migration and the
   code that needs it. Wait for it to finish, then roll back from the live
   versions.
3. List the versions of each service and pick the target version ID.
4. Roll back callers before callees. A new caller that calls an old callee
   fails. Start with the public service.
5. Check health after each service. Do not wait for the end.
6. Keep the freeze until Path B lands the same code on the main branch.

<!-- kickoff: The commands to list versions, roll back one service and read its health, and the rollback order of the services. -->

## 4. Path B: forward fix

1. Open a revert PR or a fix PR against the main branch. To revert a merged
   PR, add the `revert` label to it. See
   [revert a merged pull request](#revert-a-merged-pull-request).
2. Merge it when CI passes.
3. Watch the deploy workflow until it ends.
4. Check that health reports the new SHA.

To put a known-good commit live, make it the head of the main branch. Do not
deploy an old SHA by hand.

### Revert a merged pull request

Add the `revert` label to a merged PR. The
[Revert workflow](../../../.github/workflows/revert.yml) starts a run of
itself on the default branch, because only that branch may use the release
bot's key. That run:

1. Reverts its merge commit on a `revert/<number>` branch, with `-m 1` for a
   merge commit.
2. Commits it as `revert: <original title>`, cut to one 72-character line, with
   a patch changeset.
3. Pushes the branch and opens the revert PR with the release bot token, so CI
   runs on it. The PR links the original.
4. Comments on the original PR, and asks for the reason for the revert.

When auto-merge merged the original PR, and the revert is low or medium risk,
auto-merge takes the revert PR once its checks pass. It may merge while `main`
is red, because it is the fix. Otherwise a person merges it. When a later change
touches the same lines, the revert conflicts. The workflow then comments on the
original PR and opens nothing, so revert it by hand or fix forward. Without the
release bot, the default token opens the PR, and CI does not start on it.

### Auto-revert

The [Auto-revert workflow](../../../.github/workflows/auto-revert.yml) acts
when CI fails on a push to the default branch. It judges main the same way
auto-merge and the red-main metric do: by the required checks of the default
branch. Main is red when a required check fails, and green when every required
check that ran passed. A check that is not required, such as a deploy job, does
not make main red here.

1. When the previous push run did not pass every required check, the branch was
   already red, so it does nothing. When no required check failed on the
   commit, it does nothing and logs the checks that failed.
2. On the first attempt, it reruns the failed jobs once, so a flaky test does
   not revert a PR.
3. When the rerun fails too, it finds the merged PR. A red release commit
   blames the merge before it.
4. When auto-merge merged that PR, it adds the `revert` label, starts the
   Revert workflow and comments on the PR. First it tries to create the
   `revert` label, which the Labels workflow also makes. This job may lack the
   permission to create it, so a project that has never run the Labels
   workflow needs that workflow to run once. A PR that a person merged gets no
   automatic revert: the person fixes forward or adds the label.

A project with a live deploy can add its deploy job to `autoRevert.watch` in
`clutch.yaml`, such as `production`. Those checks count as required for
auto-revert only, so a failed health check reverts the PR that broke it. Neither
auto-merge nor the red-main metric reads the list. See
[clutch.yaml](../../../apps/cli/README.md#clutchyaml).

The revert PR merges as the revert section above says: auto-merge takes it when
it may, and a person merges it otherwise.

### Tighten after a revert

When the Revert workflow reverts a PR that auto-merge merged, it also files a
`risk-tighten` issue. The issue lists the PR's files with their risk tiers.
It proposes to tighten the path that broke: a one-way-door rule in
`.clutch/risk.yaml`, or a check that catches the break. `clutch metrics` lists
the open `risk-tighten` issues under Watch, so the weekly digest shows them.
Close one with the reason when the path did not cause the break. The next
weekly gardening pass adds the regression test that would have caught the break,
and writes the re-land plan in its PR body.

## 5. After any rollback

1. Check health and the error rate on each service that moved.
2. Confirm that new errors attach to the restored release.
3. Tell the [owner](../project-intent.md#owner) what broke and what you did.
4. Open an issue for each leftover.

## 6. Rehearsal

Rehearse once before launch and once each quarter. Do not roll back during a
rehearsal.

- [ ] Your token has the permission to roll back each service.
- [ ] The account ID is the production account.
- [ ] You can list the versions of each service and record the live version ID.
- [ ] The health SHA of each service matches the main branch head.
- [ ] You can find each secret that a check needs without a chat or an issue.
- [ ] The last deploy passes the Path A safety checks.

To rehearse a revert, add the `drill` label to the merged PR before you add
`revert`. The revert PR gets `drill` too, and no `risk-tighten` issue is filed.
A drill does not count toward the revert brake or the revert metric.

## Related

- [Secret rotation](./secret-rotation.md)
- [Fail loudly in the right module](../../principles/fail-loudly.md)
