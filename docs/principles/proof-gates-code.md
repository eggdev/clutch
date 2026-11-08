# Proof gates code, and the owner gates the product

Agents drive the project. The [owner](../contributing/project-intent.md#owner)
sets the big picture and protects the core idea of the product. Proof decides
whether a change ships. The goal is that scoped work reaches production with no
person seeing it. A sensitive path waits for the owner's approval only until
its journeys exist, as [proof decides the rest](#proof-decides-the-rest) says.

An owner who reviews diffs becomes the slowest step, and does not catch what
breaks users. A broken sign-in looks like a small cache change in a diff. Only a
journey that signs in shows it.

## Agents decide by default

When the issue, [project intent](../contributing/project-intent.md), the
principles and the journeys answer a question, decide it. Build the change,
prove it and merge it. Do not contact the owner to confirm a direction that is
already written down.

## The owner decides

The owner stops for three product reasons:

1. **Hand testing.** A new feature or screen that the issue marks with
   `hand_test: yes` at scoping. The owner tests it after it deploys, so the
   merge does not wait.
2. **A destructive migration.** SQL that drops, empties, deletes or retypes
   stored data, or a move to a new system that the issue names at scoping.
   A migration that only tweaks a file merges on proof.
3. **A change to a critical experience.** The critical experiences are the
   [core journeys](#core-journeys) and the hard invariants in project intent.
   A change that keeps a journey's outcomes ships on proof. A change that
   removes an outcome, a screen or a route, or loosens a budget, goes to the owner.

The merge gate, credentials and project intent also stay with the owner, so an
agent cannot loosen its own gate or the idea it serves. Ask before you build, never after.

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

Every PR runs the core journeys, whatever its risk tier. A cache change in an
app can break sign-in as surely as a change to auth.

A sensitive path in `.clutch/risk.yaml` can name its journeys under `journeys:`.
When each one exists on the default branch, its path leaves the owner's hold and
CODEOWNERS. Sensitive paths include auth, billing, roles and access, migrations,
credentials and the merge gate. A change to a sensitive path merges when:

1. each journey that its paths name passes on the PR head, on each platform
   that the change reaches
2. the PR weakens no journey or budget, as `tools/github/weaker-journeys.ts`
   compares them

A change reaches web when it touches the web app or anything it imports. It
reaches native when it touches a native app, a shared runtime package or a
sensitive path. A sensitive path reaches every platform.

The judge reads its rules from the default branch. A PR that changes the journey
kit holds for the owner, so a PR cannot weaken what proves it. When a PR changes a journey, its own copy must pass,
and a check compares the named outcomes of the two copies. A renamed button
or a moved field passes that check. A removed or changed outcome, or a looser
budget, entry or platform, is a weaker journey, and it goes to the owner. So a PR cannot weaken the proof or the gate
that judges it. A path stays held for the owner until its journeys exist. The required
`journeys` check proves them on each PR.

A migration also needs its rehearsal on a branch of the production database.
A journey cannot show that a copy survives or rolls back. See
[two-way and one-way doors](./two-way-doors.md#rules-for-stored-shapes).

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
The [core journey catalog](../contributing/journeys/core.md) names the
outcomes, entry, budgets and failure states of each one.

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
- It meets the budgets in `budgets:` of `clutch.yaml`, which kickoff fills.
  The template's defaults are a cumulative layout shift under 0.01, sign-up in
  3 clicks or taps, and no accessibility error.
- A payment runs end to end. On a PR it uses the vendor's test mode. On
  production it uses live mode with a $0 plan or a full discount, and the
  journey cancels the subscription after.
- It also proves the refusals: a wrong password, a declined card, a refused
  role.

## A gate with no proof fails

- A `journeys` check that runs no journey fails when a feature ships a screen.
- A model's review finding is advice. The session answers it, and it holds no
  merge.
- A skipped deploy is red.
- The core journeys run on production after each deploy. A second failure marks
  the deploy red, and opens one `needs-owner` question that names the commit.

## Example

A PR changes how `packages/identity/**` caches the session token. It adds a
token refresh step to the sign-in journey that already exists. Sign-in fails on
iOS, so the PR holds with that failure, and no person looks at it. The fix
makes sign-in pass on every platform that the change reaches, and the PR
merges.

The same PR also moves the sign-up button below the fold, and adds a click.
The sign-up budget fails. That is a product decision, so the agent asks in its
T3 thread whether sign-up gets a fourth click, with a version that keeps 3.

## Related

- [Two-way and one-way doors](./two-way-doors.md)
- [Test the workflow](./test-the-workflow.md)
- [One door for each decision](./one-door-for-each-decision.md)
