---
name: babysit-pr
description: Drive one open pull request to green - read its checks, classify each failure as flaky, real or setup, rerun a flaky job once, fix real failures on the branch, answer review findings, and stop after 3 rounds with a report. Use after a PR is open and before it merges, or when asked to babysit, watch or get a PR green.
---

# Babysit a pull request

This skill decides what to do about a red pull request. The `bun run pr`
commands do each step, so never hand-roll a `gh pr checks` loop or dig in
`gh run view --log`. See [commands](../deliver/references/commands.md).

Run every command through `mise exec --`. The input is one PR number on a
branch that this session may push to. The output is a green PR that is ready
to merge, or a report of what is left.

## One round

1. **Wait.** Run `bun run pr wait <number>`. It returns when no check is
   pending. Exit 0 means the PR is ready: stop, and go on with the merge rules
   in [pull requests](../deliver/references/pull-requests.md#merge). Exit 2 is
   the timeout: report it as a stuck check.
2. **Read the state.** Run `bun run pr status <number>`. Note each failed
   required check, the agent review's blocking count, and whether the branch
   conflicts with its base.
3. **Sync first.** When the base moved or the branch conflicts, run
   `bun run pr sync <number>`. It stops on a conflict outside the tracker.
   Resolve that conflict by hand, then start the next round.
4. **Read each failure.** Run `bun run pr failures <number>`. It prints the
   failed step of each job and the output of each failed Nx task.
5. **Classify each failure**, with the table below.
6. **Act** on each one, as the table says.
7. **Answer the review.** Read each agent review finding on the head commit.
   Fix each `blocking` finding. Most are docs that did not move with the
   behavior: change the page that the finding names. For a `note`, fix it when
   it is cheap and right. Otherwise reply in its thread with the reason, and
   leave it.
8. **Push** the fixes with `bun run pr open --title "<title>" --body-file <file>`,
   after `bun run validate` passes. Then start the next round.

| Class | Signs | Act |
| ----- | ----- | --- |
| Flaky | A test passed on the same commit before, or times out with no code change near it. A known flaky test, such as a 5 s timeout under load. | Rerun only the failed jobs once: `gh run rerun <run id> --failed`. The run id is the number after `/runs/` in the failure's URL. A second failure of the same test is real. |
| Real | The failure points at code, a test or a doc that this PR changed. | Fix it on the branch. Run `bun run validate` locally before the push. |
| Setup | A missing secret or variable, a runner or network error, an action that cannot be fetched, a permission the token lacks. | Do not change code to hide it. Rerun once when it looks transient. Otherwise report it to the owner with the failing step. |

## Limits

- Stop after 3 rounds, even when checks still fail. More rounds rarely fix
  what 3 did not, and they hide a real problem behind reruns.
- Rerun a job at most once per round, and never rerun a real failure.
- Never weaken a check to pass it. Do not skip a test, raise a budget, add a
  lint exception or delete an assertion. Those are guardrail changes that a
  person reviews.
- Never push with `--no-verify`, and never merge from this skill. The merge
  follows the merge rules.

## Report

After the last round, post one comment on the PR with `gh pr comment`, and
give the same text in your reply:

```markdown
Babysit report, round <n> of 3, head <sha>.

- Fixed: <each real failure or finding, and the commit that fixed it>
- Reran: <each flaky job, and whether it passed>
- Left: <each failure or finding still open, its class, and why it is left>
- Needs the owner: <each setup problem or decision, or "nothing">
```

When the PR is green, say so in one line instead, with the head commit.
