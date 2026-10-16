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

1. Define intent and acceptance criteria in the issue or PR.
2. Implement the change.
3. Run `mise exec -- bun run validate`.
4. Capture what was learned in docs, tests or tooling.
5. Promote repeated guidance into mechanical enforcement.

See [checks](./setup/checks.md) for the suites that each kind of change needs.

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

## Working agreements

- Keep changes scoped. Split large work into smaller steps.
- Put the verification commands you ran in the PR description.
- Update docs in the same change when a workflow or constraint shifts.
- Document when to use a new pattern in the change that adds it.

## Keep docs from drifting

The checks in `tools/` catch most drift on each change: missing file
references, changelog language, decision record numbering, the `AGENTS.md`
budget, leftover kickoff slots, workflow references and undocumented dependency
overrides.

Cursor Bugbot reviews each PR against `.cursor/BUGBOT.md`. That file holds only
the rules that a check cannot catch yet. When a check covers a rule, delete the
rule from `BUGBOT.md`.

Record follow-up work as an issue. Leftovers from a migration follow
[delete what is off the common path](../principles/delete-off-the-common-path.md):
remove them in the same change when safe, otherwise open an issue with the
[cleanup form](../../.github/ISSUE_TEMPLATE/cleanup.yml). Its "Ready when"
field is a criterion that a person can prove true or false. A code comment is
never the only record of a leftover. Report a bug with the
[bug form](../../.github/ISSUE_TEMPLATE/bug.yml), one bug in each issue.

## Weekly gardening

Once a week, an agent or a person does one short pass:

1. Read the review comments of the week's merged PRs. Find a comment that
   repeats.
2. Propose one new guardrail for it, as an issue or a PR. Use the strongest
   cheap kind from [promote learning into enforcement](#promote-learning-into-enforcement).
3. Delete stale guidance from `docs/contributing/`, and tighten unclear steps.
4. Delete each rule from `.cursor/BUGBOT.md` that a check covers.
5. Close each cleanup issue whose "Ready when" criterion is true, in the PR
   that removes the leftover.

Many small cleanups cost less than one large rewrite.

<!-- kickoff: Who runs the weekly gardening pass, and on which day. -->

## References

- OpenAI Engineering, "Harness engineering: leveraging Codex in an agent-first
  world" https://openai.com/index/harness-engineering/
