# Review

This page holds the review rules for each pull request. Agent review, Cursor
Bugbot and a person who reviews read the same list. The rules here are the
rules that no lint rule, type or check enforces yet. When a check covers a
rule, delete the rule from this page in the same PR.

## How agent review runs

`.github/workflows/agent-review.yml` runs on each pull request that is not a
draft. It runs the Claude Code GitHub Action with this page as its rules.

1. The agent reads the diff and the pages that the diff touches.
2. It posts an inline comment for each finding.
3. It posts one summary comment that lists each finding and its level.
4. It returns the number of blocking findings to the workflow.

The job fails when the agent returns one or more blocking findings. The job
also fails when the agent returns no result.

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
required status check, so a blocking finding blocks the merge. A project that
has not set up the credential keeps the default, `notice`, and the check
passes with a notice until the project adopts it.

<!-- kickoff: Whether the agent-review job is a required status check on the main branch, and who reviews when the agent finds a blocking problem. -->

## Finding levels

Each finding has one level:

| Level      | Means                                                        |
| ---------- | ------------------------------------------------------------ |
| `blocking` | The change must not merge until the author fixes it.         |
| `note`     | The author reads it and decides. The change can merge as is. |

A rule below says which level it gives. When a rule does not say, the level is
`note`.

## Always flag

Flag these on each pull request, also when a check passes. A check can pass
while its rules get weaker.

- **A changed guardrail file.** [`tools/guardrail-files.json`](../../tools/guardrail-files.json)
  lists them. Say what the change makes weaker or stronger. A weaker rule with
  no reason in the PR description is `blocking`.
- **A new escape hatch.** The
  [escape hatch table](./harness-engineering.md#guardrail-files) lists where
  each one lives. Name the rule that the hatch turns off, and the reason the PR
  gives. A hatch with no reason is `blocking`.
- **A weaker or deleted test.** Flag a test that asserts less than before, a
  deleted test whose module still exists, and a new entry in
  `tools/test-integrity-allow.json`. A deleted test with no reason is
  `blocking`.
- **Docs that did not move with behavior.** When a change alters how a module
  or flow works, the page that owns it must change in the same PR. The
  placement table is in
  [keep agent context lean](../principles/lean-agent-context.md#where-guidance-goes).
  A missing page change is `blocking`.
- **A changed native fingerprint with no native change.** The recorded native
  fingerprint decides when a native build runs. Its gate is in `tools/native`.
  A fingerprint change with no change to native code, native config or a
  native dependency is `blocking`.

## Labels

Each PR carries labels that tools and people route on:

| Label            | Set by                                                    | From                                                                                    |
| ---------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `kind/<type>`    | The [Labels workflow](../../.github/workflows/labels.yml) | The conventional type of the PR title, such as `kind/fix`.                              |
| `area/<part>`    | The Labels workflow                                       | Each workspace package or top folder the PR touches, such as `area/cli`.                |
| `size/<S to XL>` | The Labels workflow                                       | The changed lines. Above `pr_size.warn` the run warns, and it never fails.              |
| `risk/<tier>`    | The [Risk workflow](../../.github/workflows/risk.yml)     | The paths in `.clutch/risk.yaml`. See [risk](../../apps/cli/README.md#risk).            |
| `one-way-door`   | A person                                                  | The change is one-way. See [two-way and one-way doors](../principles/two-way-doors.md). |

The workflows replace a stale `kind/`, `area/`, `size/` or `risk/` label on each push.
The Labels workflow also creates `one-way-door`, so a person can always add
it. `risk/one-way-door` comes from paths. `one-way-door` is a person's call
about a change that the paths do not show, such as one that breaks a hard
invariant.

## Hard invariants

Read [project intent](./project-intent.md#hard-invariants). Flag a change that
touches a hard invariant and has no `one-way-door` label. That finding is
`blocking`. See [two-way and one-way doors](../principles/two-way-doors.md).

## One door for each decision

Flag a change that checks access, a plan limit, a flag or the acting user
outside the one function that owns that decision. Also flag a new route, job
or tool with no declaration. See
[one door for each decision](../principles/one-door-for-each-decision.md).

## Destructive automation

Flag a script or workflow that deletes a cloud resource with no name guard in
the same function. That finding is `blocking`. See
[previews](./setup/previews.md#destructive-automation-checks-the-name-first).

## Tests

Flag a mock of an internal module. Flag a fake that is not typed against the
vendor SDK. See [test the workflow](../principles/test-the-workflow.md).

## Add or remove a rule

- Add a rule when reviewers make the same comment twice and no cheap check can
  catch it. See
  [promote learning into enforcement](./harness-engineering.md#promote-learning-into-enforcement).
- Delete a rule in the PR that adds the check that covers it.
- The weekly gardening pass deletes each rule that a check already covers. See
  [weekly gardening](./harness-engineering.md#weekly-gardening).
