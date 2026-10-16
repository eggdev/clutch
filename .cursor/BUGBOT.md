# Bugbot review instructions

Review each PR against the rules below. They are the rules that no lint rule or
check enforces yet. When a check covers a rule, delete the rule here.

## Hard invariants

Read [project intent](../docs/contributing/project-intent.md#hard-invariants).
Flag any change that touches a hard invariant and has no `one-way-door` label.
See [two-way and one-way doors](../docs/principles/two-way-doors.md).

## One door for each decision

Flag a change that checks access, a plan limit, a flag or the acting user
outside the one function that owns that decision, and a new route, job or tool
with no declaration. See
[one door for each decision](../docs/principles/one-door-for-each-decision.md).
When a check enforces the declaration, delete this rule.

## Destructive automation

Flag a script or workflow that deletes a cloud resource with no name guard in
the same function. See
[previews](../docs/contributing/setup/previews.md#destructive-automation-checks-the-name-first).
When a check enforces the guard, delete this rule.

## Docs move with behavior

When a change alters how a module or flow works, the page that owns it must
change in the same PR. The placement table is in
[keep agent context lean](../docs/principles/lean-agent-context.md#where-guidance-goes).

## Tests

A mock of an internal module, or a fake that is not typed against the vendor
SDK. See [test the workflow](../docs/principles/test-the-workflow.md).
