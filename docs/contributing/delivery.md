# Delivery

For a feature, fix or refactor, follow the
[`deliver` skill](../../.agents/skills/deliver/SKILL.md). `$deliver`, `/deliver`
or "follow the deliver skill" starts it. An ordinary request for end-to-end
implementation follows the same workflow. Kickoff defines the project; delivery
works inside those decisions.

The [agent workflow](./agent-workflow.md) connects project definition, runnable
setup, research, design and delivery. Its phases use this task's single record
and existing states; they do not add approval turns or a second tracker.

## Ownership

The owner chooses outcomes, product tradeoffs and the shipping destination.
The agent extracts a brief, implements, reviews, verifies, fixes defects and
continues through the authorized destination. The owner does not have to ask
for each quality pass or say "continue" between routine steps.

Use existing session authorization. A request to build a feature does not by
itself authorize a production release, paid service or unrelated queue work.
Do preparatory work before asking for an approval that the project requires.
Follow [one-way doors](../principles/two-way-doors.md) at the affected action.

## One record per task

The [task-record procedure](../../.agents/skills/deliver/references/task-records.md)
owns the brief, states, ready queue, evidence and resume format. Keep status in
the existing tracker, with `.delivery/` as the fallback when no writable
tracker is available. Architecture docs describe the system, not task progress.

The brief records the outcome, exclusions, criteria, references, dependencies
and destination. Capture decisions from the conversation instead of giving
the owner a blank form. Group routine design choices into one proposal. Ask
only for unresolved decisions whose consequences the code cannot establish.

## Tools and skills

The [skill selection reference](../../.agents/skills/deliver/references/skill-selection.md)
routes to installed Emil skills for design, implementation, review and release
preparation. Read them in sequence. Missing optional skills do not excuse
skipping verification, and explicit-only skills keep their invocation policy.

The project's commands own repeatable setup and checks. The agent owns
investigation and judgment. Sprig owns task environments and version control
when configured; the host owns scheduling, delegated tasks and wakeups when
those are requested and supported. Delivery works with the project's existing
tools when Sprig or T3 is absent.

For repository-specific proof, use the committed
[`verify` skill](../../.agents/skills/verify/SKILL.md). Only
[`setup-verification`](../../.agents/skills/setup-verification/SKILL.md) creates
or maintains that executor and its journeys. The executor and tools work without
the authoring skill. Each repository has one verify entry point, including
monorepos; platform and flow are selections inside it. For signed Linear Todo
events, follow [`deliver-linear`](../../.agents/skills/deliver-linear/SKILL.md).
Linear holds the authoritative task, and its actual status UUIDs map to the
execution stages. Todo authorizes build, verification and a PR. Bugbot review
and retained visual evidence are required before declaring the PR ready.
Merging and release need a separate grant and their own gates.

## Evidence before handoff

[Verification setup](./setup/verification.md) defines how to run the project
and reach the states needed for review. Each acceptance criterion needs an
observed result at the tested revision. Automated tests, runtime exercises and
craft reviews answer different questions; none substitutes for all the others.

A UI review produces findings. The agent fixes confirmed defects inside the
brief and rechecks their behavior. Unrelated improvements stay in the queue.
After three unsuccessful attempts at the same blocker, record the experiments
and the smallest prerequisite needed to continue.

The handoff leads with the working result and evidence. Name missing checks
and the exact owner decision separately. An authorized release includes checking
the released build, not just starting its build job. A preview deployment may
stay available. Release local review resources unless the owner explicitly
requested a live session with its managed timeout.

## Improve the process from use

Use request-to-destination time, routine owner interventions and post-review
rework from task records to find the next bottleneck. Keep useful product
discussion distinct from prompts to restart, review again or continue.

During [gardening](./harness-engineering.md#weekly-gardening), compare those
records with review comments. Fix one recurring cause with the strongest cheap
guardrail. Measure the same signals on the next tasks; more automation earns
its place by reducing delivery time or owner effort without increasing rework.
