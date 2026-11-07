# Proof gates code, and the owner gates the product

Agents drive the project. The [owner](../contributing/project-intent.md#owner)
sets the big picture and decides what the product does. Proof decides whether
a change ships. The owner never reviews a diff, and never opens a PR.

An owner who reviews diffs becomes the slowest step, and does not catch what
breaks users. A broken sign-in looks like a small cache change in a diff. Only a
journey that signs in shows it.

## Agents decide by default

When the issue, [project intent](../contributing/project-intent.md), the
principles and the journeys answer a question, decide it. Build the change,
prove it and merge it. Do not contact the owner to confirm a direction that is
already written down.

## The owner decides

Contact the owner only for a decision that nothing written answers:

- what a [core journey](#core-journeys) or a product journey must do
- pricing and plans
- a design direction, through a design proposal
- a change that removes a journey, or weakens a check, a test or a budget

Ask before you build, never after.

## Reach the owner in a T3 thread

The owner works from T3. Each need for the owner is a T3 thread that waits on
the owner. A PR label, a PR comment or a review request does not reach the
owner.

1. The session that needs the owner asks in its own thread. Work with no
   session, such as a bot PR or a red production run, opens a thread.
2. The question carries what the owner needs to decide: the goal, 2 or 3
   options, what each one changes for users, and your pick.
3. The owner steers in the thread, and says when it is good.
4. Write the answer into the issue or project intent, so no agent asks it
   again. Merge when the proof passes.

Keep working on what does not depend on the answer. The owner stops at most 2
times a day, so a question that can wait goes into the next stop.

## Proof decides the rest

Each sensitive path in `.clutch/risk.yaml` names the journeys that prove it.
Sensitive paths include auth, billing, roles and access, migrations,
credentials and the merge gate. A change to a sensitive path merges when:

1. each journey that its paths name passes on the PR head, on every platform
2. agent review has 0 blocking findings

The judge reads its rules from the default branch, so a PR cannot loosen its
own gate. A path stays held for the owner until its journeys exist and pass.

## Grow the journeys you have

Most changes add a step or an assertion to a journey that already walks the
path. A new user goal gets a new journey. A new check, script or loop for one
change is not proof that users can do it.

- **Copy what users do.** Where the project records sessions, such as in
  PostHog, watch recent recordings of the flow. Put the real order, devices and
  detours into the journey.
- **Try what no one planned.** Add one path that a user could take: a double
  tap, the back button during payment, a slow network.

## Core journeys

Every product has these journeys. A project adds its own core features to the
list in [project intent](../contributing/project-intent.md#hard-invariants).

- sign up
- sign in
- onboarding
- profile management
- billing and checkout
- roles and access
- account security
- contact support

Each journey proves its outcome as the weakest real user meets it:

- It starts at the first screen that a new user sees. A direct route does not
  count.
- It uses a new account on the free plan. A seeded paid account hides what
  real users see.
- It runs on mobile web, desktop web, iOS and Android.
- It meets its budgets: no layout shift, sign-up in 3 clicks or fewer, and no
  accessibility error.
- A payment runs end to end in the vendor's test mode.
- It also proves the refusals: a wrong password, a declined card, a refused
  role.

## A gate with no proof fails

- A `journeys` check that runs no journey fails.
- A PR that says `unverified` does not merge.
- A skipped deploy is red.
- The core journeys run on production after each deploy. A red run starts the
  revert, and opens a T3 thread for the owner.

## Example

A PR changes how `packages/identity/**` caches the session token. It adds a
token refresh step to the sign-in journey that already exists. Sign-in fails on
iOS, so the PR holds with that failure, and no person looks at it. The fix
makes sign-in pass on all 4 platforms, and the PR merges.

The same PR also moves the sign-up button below the fold, and adds a click.
The sign-up budget fails. That is a product decision, so the agent asks in its
T3 thread whether sign-up gets a fourth click, with a version that keeps 3.

## Related

- [Two-way and one-way doors](./two-way-doors.md)
- [Test the workflow](./test-the-workflow.md)
- [One door for each decision](./one-door-for-each-decision.md)
