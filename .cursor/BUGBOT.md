# Bugbot review instructions

Review each PR against the rules below. They are the rules that no lint rule or
check enforces yet. When a check covers a rule, delete the rule here.

## Hard invariants

Read [project intent](../docs/contributing/project-intent.md#hard-invariants).
Flag any change that touches a hard invariant and has no `one-way-door` label.
See [two-way and one-way doors](../docs/principles/two-way-doors.md).

## Docs move with behavior

When a change alters how a module or flow works, the page that owns it must
change in the same PR. The placement table is in
[keep agent context lean](../docs/principles/lean-agent-context.md#where-guidance-goes).

## Tests

A mock of an internal module, or a fake that is not typed against the vendor
SDK. See [test the workflow](../docs/principles/test-the-workflow.md).
