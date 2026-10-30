# Harness engineering

This repository uses an agent-first workflow. This guide explains how to turn
each change into a durable improvement.

## Core mindset

- Humans steer outcomes. Agents do the implementation.
- Human attention is the scarce resource. Spend it on decisions, not on
  reviews that a check can do.
- Repository-local knowledge is the source of truth. If knowledge is only in a
  chat thread or a memory, assume it will be lost.
- A lint rule, type or check outranks a should-list.

## The loop

Run this loop for features, fixes and refactors:

1. Extract the delivery brief and acceptance criteria from the request.
2. Implement, exercise the changed behavior and review the result.
3. Fix confirmed defects, recheck their behavior and run
   `mise exec -- bun run validate`.
4. Continue through the authorized destination and verify that it succeeded.
5. Capture learning and promote repeated guidance into mechanical enforcement.

Follow [delivery](./delivery.md) for task ownership, skill selection, evidence
and resuming work. See [checks](./setup/checks.md) for the required suites.

## Promote learning into enforcement

When a mistake repeats, encode it in the strongest cheap guardrail that works.

1. **Lint, types or checks** when the violation is local and cheap to reject.
   Put the why in the checker message.
2. **Tests** when the failure is behavioral and a checker would guess.
3. **Scripts** when the workflow has many steps and a command can own it.
4. **Docs** describe how the system works and point at the check or test.
   Prose-only rules come last, and only when a cheap checker is not possible.

Add a static rule only when a reviewer can see the violation in the file
without reasoning about later readers, early returns or other functions. If
catching it needs that kind of reasoning, skip the rule and describe the
failure mode.

If reviewers repeat the same comment twice, encode it.

## Make failures teach the fix

A failure message is the first doc an agent reads. Each check, lint rule and
test helper prints:

- The file and line, or the name of the thing that is wrong.
- The fix, as an action: "Add `id: build` to the step", not "invalid reference".
- A link to the page that owns the rule, for the why.

A message that names only the problem costs a round trip to find the fix. See
[checks](./setup/checks.md#checks).

## Agent hooks

Claude Code and Codex run the same hook scripts while an agent works. The
scripts are in `.agents/hooks/`, and their logic is in `tools/agent-hooks/`.
`.claude/settings.json` and `.codex/hooks.json` call them.

| Hook                | Runs                                            | Does                                                                                                                                                                                                                              |
| ------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guard-guardrails`  | Before an edit                                  | Asks a person before an edit to a guardrail file                                                                                                                                                                                  |
| `guard-dev-servers` | Before a shell command or a simulator tool call | Refuses a command that starts a dev server, a simulator or a native build directly. Hints at the `bun run pr` command that replaces a raw `gh pr checks`, `gh pr merge`, `gh stack merge` or `gh run view --log`, and lets it run |
| `after-edit`        | After an edit                                   | Lints the edited files, and sends each problem back to the agent                                                                                                                                                                  |
| `end-of-turn`       | When the agent ends its turn                    | Runs the typecheck, the lint and the repository checks on a changed tree                                                                                                                                                          |

A guardrail file configures a check, a lint rule, a budget or an agent hook.
[`tools/guardrail-files.json`](../../tools/guardrail-files.json) lists them.
The guard starts when kickoff deletes `KICKOFF.md`.

- In Claude Code, the guard shows the user a permission prompt.
- Codex cannot ask from a hook. `guard-guardrails` refuses the edit, and the
  agent asks the user.
- A shell command that writes a file does not trigger the guard. CODEOWNERS is
  the control that holds: a person reviews each guardrail file at merge.

The end-of-turn hook prints nothing when the checks pass. On a failure, the
agent continues and fixes it. A turn that the hook already continued ends,
so the hook never loops.

Codex runs a project hook only after you trust it. Open `/hooks` in Codex,
and trust each hook once.

`check-agent-hooks` fails when the two configs run different hooks. It also
fails when `.github/CODEOWNERS` has no owner for a guardrail file.

## Guardrail files

A guardrail file configures a check, a lint rule, a budget, a test rule or an
agent hook. A loosened guardrail lets drift in, so a person reviews each
change to one.

- [`tools/guardrail-files.json`](../../tools/guardrail-files.json) lists them,
  and `.github/CODEOWNERS` names an owner for each.
- `check-guardrail-coverage` finds the tool scripts that the root targets,
  the lint config and the hook configs run. It follows their `@tools/`
  imports, and reads each file path in them. It fails when no guardrail
  pattern covers a file that one of them reads.
- A file that tooling reads but that sets no rule goes under `exempt`, with
  the reason.

Each escape hatch lives in a guardrail file, so the review sees it:

| Escape hatch                                              | Where it lives                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| An override that turns a lint rule off                    | `oxlint.config.ts`                                                              |
| A raised file-size budget                                 | `tools/file-size-budgets.json`                                                  |
| A knip ignore or entry                                    | `knip.jsonc`                                                                    |
| An import exception                                       | `primitives.yaml`, `exceptions`                                                 |
| A transaction-safe service                                | `primitives.yaml`, `transactionSafe`                                            |
| A test file that a change may delete or thin              | `tools/test-integrity-allow.json`                                               |
| A dependency override                                     | `tools/dependency-overrides.yaml`                                               |
| Agent review of a PR that a bot opened                    | `agent-review.yml`, `allowed_bots`                                              |
| A path kept out of a risk tier                            | `.clutch/risk.yaml`, a rule's `except`                                          |
| A zizmor finding the owner accepted                       | `# zizmor: ignore[<audit>]` in the workflow                                     |
| A Semgrep false positive                                  | `nosemgrep: rule-id -- reason` on the line, which `check-suppressions` enforces |
| A Semgrep rule off for the whole repository               | `sast.yml`, `--exclude-rule`                                                    |
| A file that tooling reads but sets no rule                | `tools/guardrail-files.json`, `exempt`                                          |
| A release range that needs no changeset                   | `tools/check-changeset.ts`, `onlyReleases`                                      |
| A changeset written for a Renovate PR                     | `renovate.json`, `postUpgradeTasks`                                             |
| Files kept out of the PR size count                       | `clutch.yaml`, `pr_size.exclude`                                                |
| Lockfiles, snapshots and `.clutch/` out of the size count | `apps/cli/src/labels/compute.ts`, `sizeExcluded` (a guardrail file)             |

<!-- kickoff: The GitHub handle or team that owns the guardrail files. Replace @eggdev with it in .github/CODEOWNERS. -->

## Working agreements

- Keep changes scoped. Split large work into smaller steps.
- Put the verification commands you ran in the PR description.
- Update docs in the same change when a workflow or constraint shifts.
- Document when to use a new pattern in the change that adds it.
- Turn on a new rule everywhere at once. Fix each violation in the same change,
  or in a few short sessions before the rule merges. Do not keep a baseline
  file of old violations. It goes stale.
- On request, the [`pr-recap`](../../.agents/skills/pr-recap/SKILL.md)
  skill writes a PR recap block: the primitives touched, the risk and a diagram.

## Keep docs from drifting

The checks in `tools/` catch most drift on each change. They find:

- missing file references
- changelog language
- decision record numbering
- the `AGENTS.md` budget
- leftover kickoff slots
- workflow references
- undocumented dependency overrides

[Review](./review.md) holds the rules that no check catches yet. An agent
reviews each PR against it in `.github/workflows/agent-review.yml`. Cursor
Bugbot reads the same page through `.cursor/BUGBOT.md`. When a check covers a
rule, delete the rule from `review.md`.

Record follow-up work as an issue. Leftovers from a migration follow
[delete what is off the common path](../principles/delete-off-the-common-path.md).
Remove them in the same change when safe. Otherwise, open an issue with the
[cleanup form](../../.github/ISSUE_TEMPLATE/cleanup.yml). Its "Ready when"
field is a criterion that a person can prove true or false. A code comment is
never the only record of a leftover. Report a bug with the
[bug form](../../.github/ISSUE_TEMPLATE/bug.yml), one bug in each issue.

## Weekly gardening

Once a week, `.github/workflows/gardening.yml` runs an agent for one short
pass. The agent edits files only. The workflow commits the edits to a
`gardening/<date>` branch and opens one pull request. It never pushes to the
default branch, and it skips the week while a gardening PR is open. A person
reviews the PR. The PR opens with the release bot's token when the
`CLUTCH_APP_ID` variable is set. A PR that the default token opens starts no
CI or agent review. See [the release bot](./setup/releases.md#the-release-bot).
The agent runs on the model that the `CLUTCH_AGENT_MODEL` repository variable
names, or on `claude-haiku-5-5` when it is unset. The workflow adds a
changeset from the PR title, and agent review reviews the PR like any other.
A second job, `calibration`, needs no credential. It opens or updates the
issue "Auto-merge calibration: week of <date>", which lists each auto-merge
dry-run verdict the owner has not graded. See
[grade the verdicts](../../.agents/skills/deliver/references/pull-requests.md#grade-the-verdicts).
The pass:

1. Read the review comments of the week's merged PRs. Find a comment that
   repeats. Read delivery records for repeated owner interventions and rework.
2. When a comment or an intervention repeats and a guardrail would stop it for
   real, propose one in the PR body. Use the strongest cheap kind from
   [promote learning into enforcement](#promote-learning-into-enforcement).
   A week with no such repeat needs no guardrail.
3. Delete stale guidance from `docs/contributing/`, and tighten unclear steps.
4. Delete each rule from [`review.md`](./review.md) that a check covers.
5. Close each cleanup issue whose "Ready when" criterion is true, in the PR
   that removes the leftover.

Many small cleanups cost less than one large rewrite.

<!-- kickoff: The day of the gardening pass, as the cron line in .github/workflows/gardening.yml, and the person who reviews its pull requests, as the GARDENING_REVIEWER repository variable. -->

## References

- OpenAI Engineering, "Harness engineering: leveraging Codex in an agent-first
  world" https://openai.com/index/harness-engineering/
