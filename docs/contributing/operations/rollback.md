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

1. Open a revert PR or a fix PR against the main branch.
2. Merge it when CI passes.
3. Watch the deploy workflow until it ends.
4. Check that health reports the new SHA.

To put a known-good commit live, make it the head of the main branch. Do not
deploy an old SHA by hand.

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

## Related

- [Secret rotation](./secret-rotation.md)
- [Fail loudly in the right module](../../principles/fail-loudly.md)
