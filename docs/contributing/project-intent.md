# Project intent

<!-- kickoff: Two or three sentences. What the product does, for whom, and the one core idea that every other decision protects. -->

Read this file before you make a product decision. When other docs or code
conflict with it, this file states the intent.

## Setup choices

<!-- kickoff: Record the reviewed setup checklist from .agents/skills/kickoff/references/setup-checklist.md: app access, auth and provider, tenancy, capabilities and platforms. Preserve any named provider or deployment constraints. Record scope decisions, not implementation status. Link to owning architecture pages or decision records for details. -->

## Owner

<!-- kickoff: The owner's name, and how an agent reaches them: where to ask a question, and which label or tag asks for approval. -->

<!-- kickoff: Where work that is not done lives: the issue tracker and its project link. Docs never hold status. -->

## Who this is for

<!-- kickoff: A table with one row for each user group: User, Goal. Mark who pays and who is invited. List groups that come later, so nobody designs them out. Then one paragraph on the primary user: market, size, place, currency and required languages. -->

Optimize for:

<!-- kickoff: Three to five bullets. Each names a user goal and the quality that serves it. -->

Do not optimize for:

<!-- kickoff: The users and features that the product turns away, with the reason. -->

Later, not now:

<!-- kickoff: Features the owner expects but deferred. One bullet each, with the condition that brings it in when there is one. -->

Do not build these yet, and do not design them out:

<!-- kickoff: For each "later" feature that a shape today could block, the rule that keeps room for it. For example, money as integer minor units plus a currency. -->

- Add no speculative code: no empty tables, no flags for features that do not
  exist, and no placeholder branches. See
  [delete what is off the common path](../principles/delete-off-the-common-path.md).

## Hard invariants

A change that breaks one of these breaks the business. Treat each change that
touches them as a one-way door
([two-way and one-way doors](../principles/two-way-doors.md)) and ask the
[owner](#owner).

<!-- kickoff: A numbered list. Each invariant is one bold sentence that a test can prove, then the detail. Cover: records that never change, actions that need explicit consent, tenant isolation, who sees what, what can always be exported, and what a user never loses. -->

## End-to-end journeys

Each hard invariant has one journey that proves it. See
[test the workflow](../principles/test-the-workflow.md).

<!-- kickoff: A numbered list that matches the invariants. Each journey is one sentence: who acts, what they do, and the assertion. -->

## What not to assume

<!-- kickoff: Bullets for the wrong mental models an agent would bring. Each is a bold false belief, then the truth. -->

- **This is not a prototype.** This app is the one that ships, and `main` is
  production. The conclusion of a spike goes into a
  [decision record](./decisions/index.md). The code of the spike does not stay
  in the repository.

## Agent guidance

- Read this file before you add a screen, field, role or flow.
- Name the user. Each feature serves a goal from this page. If you cannot name
  one, ask the [owner](#owner) before you build.
- Check each change against the hard invariants. If a change touches one, ask
  the owner.
- Use the present tense only for behavior that exists in the repository. Keep
  roadmap items in "Later, not now".
