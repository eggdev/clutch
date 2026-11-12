# Agent review

This page says how the agent review job runs and which labels each PR carries.
The rules that agent review applies, and the levels it gives, are in
[review](./review.md). That page is part of the merge gate, so the owner
approves each change to it. This page only describes the job, so a PR that
changes how the job runs updates this page and needs no approval for it.

## How it runs

`.github/workflows/agent-review.yml` runs on each pull request that is not a
draft. It runs the Claude Code GitHub Action with [review](./review.md) as its rules, under the base branch's `CLAUDE.md`, `AGENTS.md` and `.claude/`.

1. The agent reads the diff and the pages that the diff touches.
2. It reads the threads that the babysitter already answered and resolved. It
   does not raise a `note` finding again on the same path for the same rule,
   unless the diff changed its cause. It raises a `blocking` finding whenever
   its cause is in the diff.
3. It posts an inline comment for each finding.
4. It posts one summary comment that lists each finding and its level.
5. It returns the number of blocking findings and each `owner` finding to the
   workflow.

Each inline comment opens a review thread. The main ruleset requires every
thread to be resolved before a merge. The
[babysitter](../../.agents/skills/babysit-pr/SKILL.md) answers each one: it
fixes it, or replies with the reason and resolves it, or leaves it open for
the owner. The owner's approval of the head resolves the owner's threads.

The agent reads the full diff from the checkout, not from the API, so a large
PR is reviewed whole. The job also counts every inline `owner` comment, so a
short structured answer alone cannot let a PR through. A failed listing of
this head's comments is reported as a warning. A failed listing of the earlier
heads' comments fails the job, so a re-run lists them again.

Model findings are advisory. The job reports each finding, and no finding holds
the merge. The job fails only when the agent returns no result. The session
still answers each finding. `tools/github/weaker-journeys.ts` holds a PR that
weakens a journey or a budget, by comparing the two copies. See
[auto-merge](../../.agents/skills/deliver/references/pull-requests.md#auto-merge).

The agent runs on the cheapest Claude model, `claude-haiku-5-5`. To choose
another model, set the `CLUTCH_AGENT_MODEL` repository variable to its id. The
gardening workflow reads the same variable.

When the repository has no `ANTHROPIC_API_KEY` secret and no
`CLAUDE_CODE_OAUTH_TOKEN` secret, the job writes a notice and passes. A pull
request from a fork gets no secrets, so the same notice applies. Set
`agentReview.missingCredential: fail` in `clutch.yaml` to fail the job
instead, so a green `agent-review` check proves that a review ran. The job
reads the setting from the base branch, so a pull request cannot change it.
Clutch sets `fail`. A fork pull request then fails agent review, and the owner
reviews it.

The main ruleset in `.github/rulesets/main.json` makes `agent-review` a
required status check, so the review must run on each head. A project that
has not set up the credential keeps the default, `notice`, and the check
passes with a notice until the project adopts it.

## Visual review

The same job reviews the pixels too. When a PR adds, changes or removes a
screenshot baseline (a PNG in a `__screenshots__/` folder, see
[screenshots](./setup/verification.md#screenshots)), these steps run:

1. The default branch's copy of `tools/journeys/visual-review.ts` writes each
   before and after PNG, and a prompt with the PR title and body.
2. `claude-haiku-5-5` reads each pair and returns one verdict for it. A pair
   is `explained` when the PR says what changed on that screen. It is `broken`
   when the after image shows a defect. A defect is clipped or overlapping text,
   missing content, poor contrast, a scheme mix-up or an unstyled element. Set
   the `CLUTCH_VISUAL_MODEL` repository variable to use another model.
3. The script posts one comment with the before and after pictures and the
   verdicts. A new head edits that comment. The job fails when a pair is
   unexplained or broken, or has no verdict.

A PR that changes no baseline skips these steps, with no install and no API
call. A PR that changes a baseline on purpose and says why in its body passes,
so it can still merge with no person. To clear a block, fix the screen, or say
what changed and why in the PR body. Then re-run the `agent-review` job.

The job runs the default branch's copy of the script, so a PR cannot change
the code that judges it. It copies the rule pages from the default branch too. The prompt fences the PR title
and body as data, and says that `broken` comes from the image alone. The model
still reads that text in the same prompt, so a body written to sway it can. The
weekly digest shows the owner each change that passed.
While the default branch has no `tools/journeys/visual-review.ts`, the steps
write a "Visual review off" notice and skip, and a baseline change passes
unreviewed. That lasts until the PR that adds the script merges. A review of 2 pairs measured $0.006 to $0.008 on
`claude-haiku-5-5`, most of it the Claude Code prompt, which is cached.

<!-- kickoff: Whether the agent-review job is a required status check on the main branch, and who reviews when the agent finds a blocking problem. -->

## Labels

Each PR carries labels that tools and people route on:

| Label            | Set by                                                     | From                                                                                                                  |
| ---------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `kind/<type>`    | The [Labels workflow](../../.github/workflows/labels.yml)  | The conventional type of the PR title, such as `kind/fix`.                                                            |
| `area/<part>`    | The Labels workflow                                        | Each workspace package or top folder the PR touches, such as `area/cli`.                                              |
| `size/<S to XL>` | The Labels workflow                                        | The changed lines. Above `pr_size.warn` the run warns, and it never fails.                                            |
| `risk/<tier>`    | The [Labels workflow](../../.github/workflows/labels.yml)  | The paths in `.clutch/risk.yaml`. See [risk](../../apps/cli/README.md#risk).                                          |
| `one-way-door`   | A person                                                   | The change is one-way. See [two-way and one-way doors](../principles/two-way-doors.md).                               |
| `revert`         | A person, or auto-revert                                   | Adding it to a merged PR starts its [revert](./operations/rollback.md#revert-a-merged-pull-request).                  |
| `drill`          | A person                                                   | Add it to a merged PR before `revert` to rehearse a revert. The revert does not count toward the revert metric.       |
| `needs-owner`    | `bun run pr ask`                                           | An issue waits for the owner, when no T3 thread can reach them. The issue holds the question in the fixed form.       |
| `babysit:stuck`  | The [babysitter](../../.agents/skills/babysit-pr/SKILL.md) | A cap or a conflict stopped it. Its `## Babysit log` comment says why, and the session tells the owner in its thread. |
| `babysit:off`    | A person                                                   | The babysitter leaves the PR alone.                                                                                   |

The workflows replace a stale `kind/`, `area/`, `size/` or `risk/` label on each push.
The Labels workflow also creates `one-way-door`, `revert`, `drill`, `needs-owner` and the `babysit:` labels, so a person can always add
them. `risk/one-way-door` comes from paths. `one-way-door` is a person's call
about a change that the paths do not show, such as one that breaks a hard
invariant.
