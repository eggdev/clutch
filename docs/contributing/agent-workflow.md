# Agent workflow

Use these phases to establish a project and carry work through it. Enter at the
first missing prerequisite and continue within the task's authorization. A phase
is a decision procedure with an observable exit condition, not an approval turn
or a tracker status. A small fix can traverse several phases in one session.

The owner supplies product decisions and the destination. The agent recovers
context, chooses tools, implements, verifies and continues. Task progress and
evidence belong in the [delivery record](./delivery.md#one-record-per-task).

## 1. Define the project

Use [`kickoff`](../../.agents/skills/kickoff/SKILL.md) for a new project or a
template installation. Survey existing code before the interview. Settle users,
goals, hard invariants, journeys and material choices with the owner. Preserve
working behavior and record rejected choices that another agent might reopen.

Exit: project intent, journey descriptions, module ownership and decisions give
the next agent enough context to make routine choices. Kickoff owns its numbered
interview phases; these lifecycle phases do not change the installer stages.
The template itself retains its kickoff slots until used for a product.

## 2. Establish a runnable baseline

Follow [verification setup](./setup/verification.md). Establish complete-stack
startup, status, logs, cleanup, disposable accounts and data, and access to each
selected platform. Use [`setup-verification`](../../.agents/skills/setup-verification/SKILL.md)
to package existing commands and a feature map when runnable code exists.

Exit: another session can follow the recorded commands, drive one real user
journey, inspect its side effects and retain proof after cleanup. Record other
journeys as unrun. With no runnable application, record the exact prerequisite
in the task and establish this baseline with the first runnable slice. Do not
generate a passing receipt from a build or an invented driver.

## 3. Ground the task

Use [`deliver`](../../.agents/skills/deliver/SKILL.md) to recover the task and
extract its brief. Follow its [research procedure](../../.agents/skills/deliver/references/research-and-design.md)
for unfamiliar behavior, ambiguous reports or work continued from another chat.
Restate the user-visible problem, trace the affected runtime path, and separate
observed facts from hypotheses. Recover earlier decisions and failed attempts
without treating old transcripts as proof of the current implementation.

Exit: the task names its outcome, acceptance criteria, constraints, evidence
sources, dependencies and authorized destination. An unresolved product choice
gets one focused question with a recommendation. Known choices remain settled.

## 4. Explore the design

For a new shared module, start with a caller's usage example and core types.
For unsettled interactions, use installed `emil-prototype` guidance to compare
runnable options. Use `codebase-design` for module interfaces when available.
Answer consequential uncertainty with the smallest executable experiment.

Exit: a selected approach has a usage sketch or prototype, a reason for the
choice and evidence for the risky assumption. Record rejected alternatives in
the task. A settled design or routine fix proceeds directly to implementation;
neither needs an architecture contest. When implementation exposes repeated
workarounds, revisit the design rather than extending the plan around them.

## 5. Implement, review and verify

Delivery owns choosing [craft skills](../../.agents/skills/deliver/references/skill-selection.md),
small implementation increments, the repository gate and changed journeys.
Review findings return to implementation and verification. Use the actual
platform and representative older state when the change touches them.

Exit: each required criterion has current-revision evidence or a named blocker.
The feature map and owning docs match the behavior. Tests, runtime exercises
and craft reviews retain their separate purposes. Missing required evidence
cannot become a pass because another check is green.

## 6. Reach the destination

Follow [delivery](./delivery.md) to finish the authorized preview, PR, merge or
release and verify the destination itself. Keep a review environment available
when that is the requested result. A request for a preview does not authorize
landing; a verified preview can be complete without an extra approval.

Exit: the destination is confirmed, or the task has a specific pending judgment,
operation or prerequisite and an executable resume action. Use host watchers
for pending operations when supported. A Markdown record cannot run idle work.

## 7. Improve from evidence

Follow [gardening](./harness-engineering.md#weekly-gardening). Use task records
and review comments to find recurring interventions, rework and verification
failures. Separate a product defect, a driver defect and an inaccurate feature
map before choosing a correction.

Exit: one recurring cause has a focused fix or tracked follow-up. Re-exercise a
changed driver. Compare request-to-destination time, owner interventions and
rework on later tasks before adding more machinery.

## Readiness for more autonomy

Check readiness from executed evidence in task records, not a second status
spreadsheet. Recheck the affected capability after tooling or environment
changes. These conditions apply to the workflow being enabled; an unrelated
missing platform does not prevent work that does not depend on it.

- **Bounded delivery:** phases 1 and 2 supply project decisions and a repeatable
  environment. One real task demonstrates phases 3 through 6.
- **Parallel work:** each worker has isolated code and mutable runtime state,
  including ports, profiles and data. Exercise concurrent instances before
  enabling concurrent delivery. Use `clutch worktree new` for each worker, and
  host delegation when requested. A separate checkout alone does not isolate
  an external database.
- **Triggered delivery:** configure [`deliver-linear`](../../.agents/skills/deliver-linear/SKILL.md)
  with the actual project, status identifiers, integration base and destination.
  Exercise duplicate and stale events, claims, resume and failure reporting.
  Verify signed ingress, retained evidence and the required review integration
  before enabling the route. A prepared or disabled route is not live dispatch.
- **Merge or release:** require an explicit grant and evidence for the project's
  landing and release gates. Todo retains its configured PR destination until
  that grant changes. Independent review must actually complete on the relevant
  revision; requesting a review is not a passing result.

`clutch worktree` owns task environments. It uses plain git worktrees. Sprig is
a possible later backend. See `.clutch/issues/CL-901.md`. T3 or another capable
host owns requested delegation, scheduling and wakeups. Repository commands own
repeatable setup and proof. Keep those responsibilities separate so the workflow
survives a change of host or model.

## Basis

This workflow adapts verification infrastructure and evidence-led design from
Lauren Tan's [pstack Part 1](https://x.com/poteto/status/2094457600259842065)
and [Part 2](https://x.com/poteto/status/2097732320606507506/). The repository's
delivery, verification and engineering guidance owns the executable procedure.
The articles' throughput claims are not acceptance criteria for this workflow.
