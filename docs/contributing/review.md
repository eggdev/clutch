# Review

This page holds the review rules for each pull request. Agent review, Cursor
Bugbot and a person who reviews read the same list. The rules here are the
rules that no lint rule, type or check enforces yet. When a check covers a
rule, delete the rule from this page in the same PR. How the agent review job
runs, and the labels each PR carries, are in [agent review](./agent-review.md).

## Finding levels

Each finding has one level:

| Level      | Means                                                        |
| ---------- | ------------------------------------------------------------ |
| `blocking` | The author fixes it or answers why not. It holds no merge.   |
| `owner`    | The author weighs it with the owner. It holds no merge.      |
| `note`     | The author reads it and decides. The change can merge as is. |

A rule below says which level it gives. When a rule does not say, the level is
`note`.

## Owner findings

An `owner` finding tells the session to weigh a concern with the owner. It does
not hold the merge, and neither does a `blocking` finding. A deterministic check
holds a weaker journey: see [proof gates code](../principles/proof-gates-code.md).
The [weekly digest](./capabilities/factory-observability.md#weekly-digest) lists each `owner` finding of a merged pull request.
An `owner` finding has two causes only. Start the finding with its level, `owner`, then name its cause,
`hard core` or `weaker check`. Any other concern is a `note`, or `blocking`
when another rule says so.

1. **Hard core.** The diff changes a path of the `one-way-door` tier of
   [`.clutch/risk.yaml`](../../.clutch/risk.yaml). That is a credential, and
   auth and access until their journeys exist. It is also a migration that can
   lose data, a workflow line that gives a grant, and the `owner:` line of
   `clutch.yaml`.
   It is also the billing and infra paths that a project names. The merge judge also holds a major change and a contract break, see
   [decision record 0005](./decisions/0005-the-owner-signs-off-what-cannot-be-paid-back.md).
   CODEOWNERS or auto-merge already holds such a PR, so the finding says what
   the owner should look at.
2. **A weaker check.** The change makes a check that gates the merge catch
   less on code that already exists. Such a check is a required status check or one of its steps, a lint rule, a budget, a ratchet or a test. Agent review itself is one too. The check is weaker when it is turned off,
   skipped, loosened or deleted, or when a budget rises. A test is weaker when
   a test or an assertion goes while the behavior it guards stays, or when it
   asserts less. A new exemption, ignore, knip entry or allow-list entry is
   weaker too, whichever files it covers. Name the check and what it stops catching.
   That holds with or without a reason in the PR description.

These are not `owner`:

- A new check or a new feature, with its own tolerance, threshold or option.
  It catches more than before, not less. Example: #185's pixel tolerance in a
  new screenshot compare.
- A test whose expectation moved with an intended change, and which asserts
  the same amount.
- A tool that does not gate the merge, such as `pr status`, `pr merge`, a
  skill's script or a dev tool. The ruleset and auto-merge are the gate.
  Examples: #153, #154 and #173. A file that configures a check still counts when the change weakens that check. Examples: `tools/validate.ts`, `tools/testing/**`, or a generator that a check runs.
- A guardrail file that changed and is not weaker. Say what it makes stronger,
  as a `note`.
- A product defect. That is `blocking` or a `note`.

## Always flag

Flag these on each pull request, also when a check passes. A check can pass
while its rules get weaker. Most PRs merge with no person, so these findings
are how a weaker check reaches the owner.

- **A weaker check**, as [owner findings](#owner-findings) defines it, is
  `owner`. A stronger check is a `note`.
- **A changed guardrail file.** [`tools/guardrail-files.json`](../../tools/guardrail-files.json)
  lists the files that configure a check. Say what the change makes weaker or
  stronger. Only a weaker rule is `owner`.
- **A new escape hatch.** The
  [escape hatch table](./harness-engineering.md#guardrail-files) lists where
  each one lives. A hatch turns off a check for some files or cases. Name the
  rule that the hatch turns off, and the reason the PR gives. A new hatch is
  `owner`. A hatch with no reason is `blocking`. A new option of a new feature
  is not a hatch.
- **A weaker or deleted test.** Flag a test that asserts less than before, and
  a deleted test whose module still exists. Each one is `owner`. A deleted test
  with no reason is `blocking`.
- **Docs that did not move with behavior.** When a change alters how a module
  or flow works, the page that owns it must change in the same PR. The
  placement table is in
  [keep agent context lean](../principles/lean-agent-context.md#where-guidance-goes).
  A missing page change is `blocking`. A change to how the agent review job
  runs moves [agent review](./agent-review.md), not this page.
- **A changed native fingerprint with no native change.** The recorded native
  fingerprint decides when a native build runs. Its gate is in `tools/native`.
  A fingerprint change with no change to native code, native config or a
  native dependency is `blocking`.

## Hard invariants

Read [project intent](./project-intent.md#hard-invariants). Flag a change that
touches a hard invariant when its PR shows no passing run of that invariant's
journey. That finding is `blocking`. A change to what an invariant says is an
`owner` finding. See [proof gates code](../principles/proof-gates-code.md).

## Single-page app

`check-structure` fails a route that renders on the server when
`tools/server-rendered-routes.yaml` does not name it with a reason. It also
fails a Vite config whose default render mode it cannot read. Review
holds the rest of the principle. Flag a server render of a screen that reads
the account's records. Also flag a listed reason that is not true for the
route. Each finding is `blocking`. See
[single-page app](../principles/single-page-app.md).

## One door for each decision

Flag a change that checks access, a plan limit, a flag or the acting user
outside the one function that owns that decision. Also flag a new route, job
or tool with no declaration. See
[one door for each decision](../principles/one-door-for-each-decision.md).

## Mobile first

The lint rule `repo-layout/no-viewport-reads` fails a component that reads the
window width in code. Review holds the rest of the principle. Flag a viewport
breakpoint class in a component, such as `lg:flex-row`, and a width `@media`
query in its styles. Flag a width read that the rule does not see, such as
`document.documentElement.clientWidth`, `visualViewport.width` or a `resize`
listener. Flag a style for desktop that a phone class then undoes. Flag an
action that the phone layout removes, and an action that only hover shows.
Also flag a touch target smaller than 44 by 44 px. Each finding is `blocking`.
See [mobile first](../principles/mobile-first.md).

## Destructive automation

Flag a script or workflow that deletes a cloud resource with no name guard in
the same function. That finding is `blocking`. See
[previews](./setup/previews.md#destructive-automation-checks-the-name-first).

## Principles that no check holds

The [principles index](../principles/index.md) marks these principles
`Review only`. Review is the only thing that stops a change that breaks one.
Each finding below is `blocking`.

- **Keyboard first.** Flag a key that a file outside the shortcut registry
  binds. Flag a new common action with no shortcut, and a menu item or tooltip
  that does not show its shortcut. Also flag a single-key shortcut that fires
  in a text field. See [keyboard first](../principles/keyboard-first.md).
- **Fix the root bottleneck.** Flag a timeout, a fallback, a degraded mode or
  a cache that hides slowness, unless the same change links an issue for the
  root fix. See [fix the root bottleneck](../principles/fix-the-root-bottleneck.md).

## Tests

Flag a fake that is not typed against the vendor SDK. See
[test the workflow](../principles/test-the-workflow.md).

## Add or remove a rule

- Add a rule when reviewers make the same comment twice and no cheap check can
  catch it. See
  [promote learning into enforcement](./harness-engineering.md#promote-learning-into-enforcement).
- Delete a rule in the PR that adds the check that covers it.
- The weekly gardening pass deletes each rule that a check already covers. See
  [weekly gardening](./harness-engineering.md#weekly-gardening).
