---
name: deliver
description: Implement, review and verify one agreed task through its authorized local, PR, merge or release destination. Use for feature/fix work or resuming an existing task. Use audit-codebase for findings and setup-verification for creating verification tooling.
---

# Deliver

Own the task through its destination. Specialist review produces findings;
return here to fix confirmed defects and verify the result.

## Recover and decide

Read agent guidance, project intent, owning code and the existing task record.
Inspect the checkout before editing. Use [task records](./references/task-records.md)
for one authoritative brief, evidence and resume point; do not invent a ticket.

Extract outcome, acceptance criteria, exclusions, destination and permissions.
An issue with `owner: agent` ends merged to `main`. Any other unspecified
destination means a verified local result, not merge or release.
A plain task request does not authorize an unattended queue.

Before asking anything: reuse a settled decision; look up observable facts;
choose reversible implementation details yourself. Ask only an unresolved product,
access, cost or retention decision that blocks the task. The owner decides the
product and proof decides the code: see
[proof gates code](../../../docs/principles/proof-gates-code.md). Finish independent
work before you ask, because the question holds the turn. Do not ask for approval of routine next steps.

### Ask the owner

Ask in this session's own thread, with the question tool, so T3 shows the
thread as waiting. A PR label, a PR comment or a review request does not reach
the owner. The question tool holds the turn until the owner answers, so finish
the work that does not depend on the answer first. Use one fixed form:

```markdown
## Goal

Sign-up needs an email check, and the budget is 3 clicks.

## Options

A. Check the email on a later screen. B. Add a fourth click.

## What each option changes for users

A keeps 3 clicks. B stops a typo before the account exists.

## My pick

A, because the budget is the product's promise.
```

An approval ask uses the same form. The options are approve and hold.

The owner stops at most 2 times a day. Put a question that can wait into the
next stop, and ask once for each decision, and once for each head that needs an approval. A lane does not ask. It puts the
question at the end of its reply, and the coordinator asks once.

When the session has no question tool, such as when the owner does not run T3,
open one issue in the same form:
`mise exec -- bun run pr ask --title "<the question>" --body-file <file>`. It
labels the issue `needs-owner` and assigns the owner. It refuses a section with
no text. Read the answer on the issue, and close it with `gh issue close <n>`.

When the issue says `hand_test: yes`, ask the owner to test it after it deploys,
with its link. The merge does not wait for that test.

After the owner answers, write the answer into the issue or project intent, so
no agent asks again. Then merge on proof. A held path still needs the owner's
approval, so give the approve link in the thread: the PR's URL plus `/files`. A push that changes
the diff drops the approval. When the owner approved as well, do not push the
answer. Write it in a follow-up PR after the merge.

For ambiguous reports, unfamiliar modules or relevant earlier work, follow
[research and design](./references/research-and-design.md). Recover prior
decisions, check them against current code and restate the problem before
choosing a fix. Keep the compact findings in the task, with sources.

For ambiguous mechanics or unfamiliar modules, trace the real entry point,
recover bounded relevant prior evidence and run a discriminating experiment.
Stop research once the next implementation step is justified; an old assistant
claim is a lead, not evidence or authorization.

## Implement

Use existing repository tools and preserve unrelated work. Apply
[skill selection](./references/skill-selection.md) only for the task's current
stage. A missing optional craft skill does not excuse missing runtime proof.

Select the needed runtime before starting it:

- Library/CLI: exercise the public boundary with disposable inputs and real
  dependencies. Start no web stack solely to satisfy a template.
- Isolated journey runner: let it own setup and teardown; do not start a duplicate.
- Interactive web/native journey: use verify's launch and doctor, then the
  supported browser/device tool. A busy foreign port is a conflict.

Use the local `.agents/skills/verify/SKILL.md`. If absent or missing a required
journey, invoke setup-verification to establish or extend it; then return to
delivery. Never create verify-<project> or a parallel lifecycle runner.

Implement reviewable increments, run focused checks, review the diff and correct
confirmed defects. Record unrelated findings without expanding scope. For
persisted state or installed clients, exercise supported older state as well as
fresh fixtures. UI work needs action/result proof on the affected platform;
browser emulation and compilation do not establish native interaction.

When a consequential design choice remains open, use the research and design
procedure to test a usage sketch or prototype before committing to it. A
settled direction proceeds to implementation without another planning gate.

Build your pick of a new visible feature. Do not wait for a design choice.
State `hand_test:` in the issue, and the owner looks after it deploys. Use a
[design proposal](../design-proposal/SKILL.md) only when the owner asks for options.

## Verify and finalize

Run verify's mapped proof and the required repository gate. Record criterion,
revision, environment, expected/observed result and evidence. Changed relevant
source, app build or backend invalidates previous proof. A test selection that
runs nothing is not success.

Classify failures as product defect, harness gap or prerequisite. Correct
in-scope defects and rerun the affected path. Stop repeating an unchanged
experiment. After three unsuccessful experiments on the same blocker, retain
the evidence and the smallest unblock action rather than hiding the failure.

Finalize every review session on success, failure, cancellation or blockage.
Verify owned resources were released; quarantine uncertain cleanup before reuse.
Keep a live session only when explicitly requested, with its timeout/extension
policy. A working preview deployment is not permission to retain a local server.

## Complete the destination

Continue through already authorized commit, PR, merge and release actions.
Use the repeatable command for each step from [commands](./references/commands.md),
never a hand-rolled `gh` or `git` sequence.
Open, stack and merge PRs with the commands in
[pull requests](./references/pull-requests.md): ready for review, never a draft,
and in one linear stack when a PR builds on another open PR.
Verify the actual destination, not only submission or a build job.

A PR destination makes this session own the PR through its merge. No workflow
or schedule finishes it later:

1. `bun run pr open` opens the PR.
2. [babysit-pr](../babysit-pr/SKILL.md) rounds take it to ready. In T3,
   register the PR and watch it, so each change to its checks or reviews
   starts the next round. Elsewhere, `bun run pr wait` blocks between rounds.
3. `bun run pr merge <number>` dispatches the auto-merge judge. The judge
   decides whether the PR merges now or waits for the owner's approval. An
   open PR authorizes this step, because the judge applies the repository's
   auto-merge rules. `--owner` needs the owner's word.
4. `pr merge` waits for the release and for CI on `main`. When `main` goes
   red, it starts the revert, and this session drives the revert PR to the
   merge too.

Delegated children return their result to the parent rather than watching
independently.

When a lane runs the work as stage agents, follow the hand-off contract in
[stage agents](../../../docs/contributing/stage-agents.md).

For a Linear issue, deliver-linear owns intake, status and its configured review
gates; this skill owns implementation. A Todo transition grants a PR; the merge
follows the repository's auto-merge rules, through `pr merge`.

Mark done only when the destination and required proof exist. Missing proof
stays failed/unverified with its prerequisite. Owner review is a state only
when an actual owner judgment remains. Report usable result, evidence and
material limits; update the task before yielding or compaction.

Continue to another task only within an explicitly authorized queue. Skills and
Markdown do not run in the background without a configured host execution path.
