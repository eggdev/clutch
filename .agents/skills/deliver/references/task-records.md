# Task records and the ready queue

Use the project's configured tracker from project intent when the session can
read and update it within the owner's authorization. Keep the delivery brief
and evidence in that issue, or its linked task document. Do not create a second
status list in the repository.

When no writable tracker is available, use one Markdown file per task under
`.delivery/` at the repository root. Use a stable descriptive ID such as
`capture-retry`. Keep these files outside durable architecture docs: task state
changes as work proceeds. Never store credentials, personal data or private
logs in the record. Local artifacts can be referenced by path.

If moving a local task to a tracker, transfer the record, replace the local
content with its destination link and use the tracker thereafter. Do not keep
two editable copies. Use the existing tracker workflow and map the states
below onto it; do not change a team's workflow configuration for this skill.

## State follows evidence

| State | Enter when | Leave when |
| --- | --- | --- |
| Idea | Outcome or a material product decision is unresolved | The brief is settled and dependencies are named |
| Ready | Scope, criteria, destination and execution permission are settled; dependencies are satisfied | An agent claims it and records its session and checkout |
| Active | One owner is working the task | It reaches its destination, needs review, or cannot proceed |
| Blocked | A named dependency, failed recovery or unavailable capability prevents progress | The prerequisite is satisfied and an agent resumes |
| Review | The next step requires owner judgment or approval; preparatory work is complete | The owner responds or the task is returned for correction |
| Done | Required criteria and the agreed destination have evidence | New evidence requires follow-up or reopening |

A preview task can be done when the working preview is verified. A release
task is not done at preview or PR. A required device check that cannot run
leaves the task blocked; a check reserved for the owner leaves it in review.
"Ready for you to inspect" does not add an approval gate. If the local result
is the agreed destination and no decision remains, mark done and hand it over.

List ready tasks through the tracker, or inspect `.delivery/*.md`. Use the
owner's priority order, and skip tasks whose dependencies are unmet. Confirm
that no other session owns a task before claiming it. A recorded owner is a
coordination signal, not an atomic lock: use the host's claim facility when
available and do not run competing queue dispatchers over local Markdown.

Queue execution needs an explicit scope, such as "work these three issues
through PR creation." Each task still carries its own external-action
permissions. An agent cannot authorize new work by marking its own idea ready.
For a blocked task, record the unblock condition before taking other already
authorized work. Without queue authorization, finish or hand back the one task.

## Record format

Create only the sections the task needs. Keep criterion IDs stable so a review
can refer to C1 without repeating the brief. The example is a shape to fill,
not a request to ask the owner about each field.

```md
# <ID>: <outcome>

State: <idea | ready | active | blocked | review | done>
Priority: <owner's order>
Owner: <session link or identifier>
Checkout: <path, branch and Sprig task ID when used>
Requested: <timestamp>
Destination: <working preview | PR | merge | release; name the target>
Authorization: <what the owner requested; cite the message or issue>

## Brief
<Who can do what after delivery, scope and exclusions.>

## Acceptance
- C1: <observable result, platform, role and data condition>
- C2: <observable result>

## References and decisions
- <Approved prototype or decision; interactions to preserve.>
- <Decision, reason and source. Mark unresolved decisions explicitly.>

## Dependencies
- <Prerequisite, whether satisfied, and how to check it; or none.>

## Evidence
| Criterion/check | Revision and environment | Action or command | Expected | Observed and artifact | Pass/fail/unverified |
| --- | --- | --- | --- | --- | --- |

## Resume
- Revision: <SHA; also describe uncommitted changes when present>
- Last completed action: <fact>
- Next action: <executable step>
- Environment: <start/status command, URL, logs, pending build/check ID>
- Blocker: <exact error, attempts, unblock condition; or none>

## Delivery
- <PR, landed SHA, preview or release build; destination check result.>

## Learning
- Review ready: <timestamp>
- Completed: <timestamp>
- Owner interventions: <corrections, routine prompts, or product decisions>
- Rework: <what changed after review and why>
- Follow-up: <linked task or recurring failure to address>
```

Update at stage changes and before yielding, not after every tool call. Retain
failed evidence and mark evidence superseded when the implementation changes.
Identify the tested revision with a SHA or a description of the working-tree
changes. On resume, compare it with the actual checkout before trusting it.

## Pending work outside an active turn

Save operation IDs and use a supported host watcher for CI or a build. When
explicitly asked to run a persistent queue, use the host's scheduler or task
orchestration and retain its identifiers. Without that capability, state the
next resume action. Markdown and skills do not execute while the agent is idle.
