# Author a journey

Use when the owner asks for a journey, a changed behavior has no mapped proof,
or an existing flow does not cover the acceptance criterion. A journey describes
a user's goal and observable outcomes. A route list or a sequence of clicks
without assertions is not a journey.

## 1. Establish the goal

Read the request, project intent, relevant feature contracts and the current
feature map. Recover a relevant earlier decision when needed, then reconcile
it with the current contract and code. State who is acting, what they want,
which platform matters and the result that would demonstrate success.

Infer routine details from evidence. Ask only when an unresolved product choice
changes the expected outcome, role, data access or side effects. Do not make
the owner fill in a blank test form. Existing behavior is evidence of mechanics,
not permission to redefine the product's intended result.

## 2. Choose reuse, extension or a new journey

- An existing mapped flow proves the outcome: reuse it and explain the match.
- It reaches the right state but omits a required observation: extend that
  journey rather than adding a second copy of its setup and actions.
- No existing flow reaches the goal: draft the smallest complete journey.
- The goal is still exploratory: drive it with the project's controls and host
  browser/device tools first. Keep the script in task scratch space unless it
  meets the project's threshold for a permanent end-to-end test.

Avoid selecting a convenient passing flow that does not prove the request.
Use lower-level tests for logic they can prove; retain real user-path evidence
for the interaction being verified. Do not create a permanent end-to-end test
for every task.

## 3. Write an executable specification

Fill these fields from the repository. Keep the draft in the existing task
record until it is registered in the feature map; do not maintain two copies.

```md
# <stable journey ID>: <user goal>
State: draft
Contract: <acceptance criterion or owning product page>
Actor and platform: <anonymous/role, web/device/CLI/runtime>
Entry: <real route, command or gesture>
Prerequisites: <owned instance, fixture, role and capabilities>
Isolation and cleanup: <records/session created, who owns them, cleanup command>

| User action | Expected observation | Proof |
| --- | --- | --- |
| <enter through the real user path> | <observable initial condition> | <assertion/recording> |
| <perform the important interaction> | <visible outcome and affected side effect> | <assertion/artifact> |
| <recover, reload or return when relevant> | <state required by the contract> | <assertion/artifact> |

Failure condition: <denied, unavailable or invalid path this goal actually touches>
Driver: <existing tool/test plus exact command and selection>
Evidence: <persistent destination and action/result artifacts>
Limits: <platforms, dependencies or outcomes this journey does not prove>
```

Keep a missing prerequisite explicit. Use established disposable fixtures and
cleanup, never a person's account or live records. A fresh browser context does
not isolate the database. Before a flow that writes, name its fixture owner,
side effects and cleanup path. Missing fixtures require a prerequisite task or
an in-scope fixture change, not an authentication bypass or production access.

Select failure, persistence, role and platform conditions from the actual goal;
do not multiply every draft into an exhaustive matrix. An external sandbox or
mock proves only its named boundary. Do not claim real delivery, payment or
device behavior from a stand-in.

## 4. Register and exercise

Use the project's current driver. Resolve accessible selectors and commands
from the actual surface; never invent a working selector from prose. Extend an
existing test or author the bounded script selected above. Do not drive the
result through internal setters or replace the behavior under test with a mock.

For retained journeys, register the feature page, index entry and executable
flow in the local harness using that project's registration instructions.
Keep one-time exploratory scripts and their proof in the task instead.
Reuse existing IDs when extending a flow.
Inspect the runner's selected test list before execution: broad name filters
can accidentally include account creation, writes or unrelated tests. No tests
selected is a failure, not a successful proof.

Run doctor, execute the chosen flow, capture action and result, verify relevant
side effects and clean up owned state. Confirm the artifacts survive cleanup.
Record revision, environment, command, expected result, observed result and
evidence in the task. Do not commit secrets, sessions or raw transcripts.

Classify the execution as passed, failed, prerequisite missing or not run. Only
an executed pass establishes verification. A draft may be complete as a design
deliverable when drafting is all the owner requested; label its execution
unverified. For a request to create a usable flow, continue through execution
unless a named prerequisite blocks it. Diagnose product defects, driver gaps
and map drift separately; do not weaken the expected result to make it pass.
