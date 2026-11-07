---
name: kickoff
description: Onboard new or existing projects with an upfront setup checklist, then a focused product interview. Writes project intent, architecture pages, decision records and the primitives registry. Use when KICKOFF.md exists, or when the user says kickoff, define the project, or start a new project.
---

# Kickoff

You turn the owner's idea into the docs that steer every later agent. The
owner talks about the product once. After kickoff, every agent works from the
docs and asks the owner only what the docs do not decide.

The docs are the state. Each `<!-- kickoff: … -->` slot is a question that is
still open. This command lists them, so a new session can resume:

```sh
mise exec -- bun tools/check-kickoff-slots.ts --list
```

## Rules of the interview

1. **Checklist first.** Collect capability choices together using
   [the setup checklist](./references/setup-checklist.md). Options and toggles
   are welcome here.
2. **Then one product question at a time.** Number each question. Ask in
   prose and let the owner answer in their own words. Skip a choice the
   checklist settled. Ask only about a missing detail or a real conflict.
3. **Do routine setup yourself.** Follow the three kinds of setup in the
   checklist. Fill facts from evidence and apply defaults without asking. For
   a product decision, show a draft and ask what is wrong with it.
4. **Look up facts. Ask for decisions.** Before you ask, read the code, the
   docs and the vendor pages. Bring the price, the deploy model and the local
   test runtime with each vendor proposal. Never ask the owner for a fact you
   can find.
5. **Converge.** Before asking a question classify the item as settled,
   implementation choice, blocking owner decision or deferred. Apply settled
   answers and routine choices; ask only the blocking owner decision. An accepted
   brief is input to reconciliation, not a reason to repeat discovery.
6. **Report progress toward completion.** State what was recorded, then perform
   the next independent setup action. End with a question only when its answer
   is needed; otherwise continue through the remaining work in this session.
7. **Write as you go.** Write defaults and verified facts directly. Write product
   decisions as soon as the owner agrees. Do not hold answers until the end.
8. **"Not yet" is an answer.** When the owner defers a topic, add it to "Later,
   not now" in project intent, and move on.
9. **No loopholes in your drafts.** Do not propose exceptions, phases, a
   "pre-production mode" or a list someone must maintain by hand. The owner
   rejects them. Build it right from the start.
10. **Principles are fixed.** Pages in `docs/principles/` come from the
    template. Do not edit them in kickoff. A project fact goes in a project
    page, and the principle links to it.
11. **Keep what works.** The code and docs that exist are where you start.
    Keep an established provider, framework, convention or pipeline unless a
    written requirement conflicts with it. Name that conflict before you
    propose a replacement. An off choice or a template default never permits
    you to delete working behavior. The owner decides each removal.

The question bank for each phase is in
[references/question-bank.md](./references/question-bank.md). The opening
question of each phase is a prompt for a draft. It is not a script.

## Entry points

Run this skill in the session the owner opened in the project, with any agent
that can read this file. `$kickoff`, `/kickoff` and "follow
`.agents/skills/kickoff/SKILL.md`" all start it. Do not launch another agent
from this session.

For a new project without an install manifest, start phase 0 below. For an
existing project, the installer switches the project's checkout to the new
branch `template/install`. Do all kickoff work on that branch. When the
checkout is on another branch, run `git switch template/install` first. Read
`.template-install/manifest.json` before you start:

- `survey`: follow [existing-project-survey.md](./references/existing-project-survey.md).
  When it sets `interview`, continue with the owner in this session.
- `interview`: follow [existing-project.md](./references/existing-project.md).
  It changes phase 0, adds Reconcile and changes phase 5. When it sets
  `migrate`, continue the migration in this session.
- `migrate`: follow [existing-project-migrate.md](./references/existing-project-migrate.md).
  When it needs an owner decision, return to the interview in this session.

`kickoff survey`, `kickoff interview` or `kickoff migrate` runs that one
stage and stops at its handoff. Without a stage name, continue through the
stages until you need the owner. Do not ask the owner to run the installer
again between stages.

When you stop early, keep the manifest, so that another session can resume.
An unknown stage is an error. Report it and do not start again from the
beginning. When the manifest and `KICKOFF.md` are both gone, kickoff is done.
Do not start it again on your own.

The install commits come before `validate` passes. For those commits only, use
`git -c core.hooksPath=/dev/null commit ...`, unless the CLI runner already
sets it. Do not change the Git configuration. The migration ends with the
full gate.

## Phases

Do the phases in order. Record the setup choices before the product
interview. Change a choice later only when the intent or a journey conflicts
with it.

### 0. Read

1. Read `AGENTS.md`, `KICKOFF.md`, `docs/contributing/project-intent.md` and
   `docs/principles/index.md`.
2. Read `git config user.name`. That is the owner unless they say otherwise.
3. If the repository has code beyond the template, survey it. Draft from the
   code, and ask only what the code cannot answer.
4. Present and record [the setup checklist](./references/setup-checklist.md).
   Resume from recorded answers instead of presenting a blank form.
5. Ask one open question: "Tell me what you want to build. Who is it for,
   what do they do with it, and why now? Say as much as you like." Let the
   owner talk. Then start the grilling.

### 1. Intent

Output: every slot in `docs/contributing/project-intent.md`.

Order: the core idea, owner and tracker, users and goals, optimize for and
not for, later not now, room to keep, hard invariants, what not to assume.

### 2. Journeys

Output: one page in `docs/contributing/architecture/` for each journey, the
"End-to-end journeys" list in project intent, and the slots in `docs/users/`.

Walk each user from the first touch to their goal, one screen at a time: how
they arrive, what they see, what they do, what each empty, error and offline
state shows, and what message or email each step sends. The walk shows which
capabilities the product needs. Collect them for phase 3.

Then fill two user pages from the walk. `docs/users/intro.md` says what the
product is and is not. `docs/users/getting-started.md` takes a new user to one
first win: a useful result they can see. Fill `docs/users/privacy.md` after
phase 3, when you know the data inventory and the vendors.

### 3. Services

Output: the slots in `docs/contributing/architecture/` (the index, request
context, authorization, data storage, feature flags, API errors, soft delete,
MCP server, local-first sync and client performance), one page for each other
package with real rules, the product entries in
`docs/contributing/architecture/primitives.yaml`, and a decision record for
each product no.

The template already decides the stack. Do not ask about it, and do not write
a decision record for it: Effect on the server, Effect Schema, Drizzle with
Postgres, the sync engine in `packages/sync`, React with React Compiler, and
the tiers and sections. The architecture pages describe each one. Ask only
which [profile](../../../docs/contributing/architecture/client.md#profiles)
each client app uses.

Take the capabilities from phase 2 that the checklist has on. Skip off and
later. Keep a chosen provider. Where no provider is chosen, research two or
three vendors. Propose one, with its owner package, its service, its price at
the owner's scale and its local test runtime. Settle
tenancy and storage first, because they are one-way doors. Fit the template
prose to the scope as well as the slots. A finished page says nothing about a
capability that is off.

Write the registry entries as the owner agrees to each part:

1. A `primitives` entry for each package, feature and app. Give it a group, a
   kind (package, feature, app or tool), a one-line summary, its `code` roots
   and its `docs` pages. Make each package and feature with its
   [generator](../../../docs/contributing/setup/nx.md#generators), so its shape
   and its primitive are right from the start.
2. A `vendors` entry on the package that owns each vendor. Only a package owns
   a vendor. Its Live Layer goes in `runtime/` and its Test Layer in
   `testing/`.
3. A `languages` entry for each other shared language, with the folders that
   may import it. React, Effect, Drizzle and TanStack already have one.
4. An `invariants` entry for each hard invariant from phase 1. Its `docs` list
   links `docs/contributing/project-intent.md#hard-invariants`.

Run `mise exec -- bun tools/check-primitives.ts` after each change to the
registry.

When the owner rejects an option that the next agent would propose again,
write a decision record from `docs/contributing/decisions/0000-template.md` and
add it to the steering list.

### 4. Harness and operations

Output: the slots in `docs/contributing/setup/`, `docs/contributing/testing.md`,
`docs/contributing/end-to-end-testing.md`, `docs/contributing/security.md` and
`docs/contributing/operations/`, `docs/contributing/architecture/styling.md`,
and `.github/workflows/ci.yml`.

Apply the [automatic defaults](./references/setup-checklist.md#apply-automatic-defaults)
for the chosen capabilities. Derive configuration, seed data, test coverage,
the secret inventory and rollback commands from the code and the journeys.
Write the results into the owning pages. Do not ask the owner to approve each
one.

Fill `docs/contributing/setup/verification.md` from the selected platforms and
journeys. Establish full-stack start, status, logs and stop, test accounts,
targeted checks and platform access. Include bundle and API connectivity for
native work and older-state fixtures for persisted or installed clients.
Check the commands that can run; record exact prerequisites for those that
cannot. Do not claim verification from a command that only builds the app.
When application code is runnable, use the `setup-verification` skill to generate or
maintain its local verification harness and exercise one mapped journey.
Without runnable code, record the prerequisite instead of generating fake proof.

Use the [agent workflow](../../../docs/contributing/agent-workflow.md) for the
handoff from project definition to delivery. In the existing task record, retain
the baseline journey evidence or the exact prerequisite for the first runnable
slice. Configure parallel or triggered work only when its readiness conditions
have evidence; installing skills alone does not enable autonomous execution.

Use the tracker chosen in project intent for delivery records. When it is
unavailable, follow the local fallback in the
[delivery task-record procedure](../deliver/references/task-records.md).
Do not open a second tracker or add another setup interview for these defaults.

Ask the owner only about open product requirements: theme, languages,
accepted security risks, support access, recovery and alert recipients.
Sections 4 and 5 of the question bank are prompts for gaps. They are not a
script. A known fact or a default that applies is work for you, not a question.

Set up the guardrails for agents:

1. Replace the owner handle in `.github/CODEOWNERS` with the project's owner
   or team. Each guardrail file in `tools/guardrail-files.json` needs a
   review from that owner.
2. Tell the owner that deleting `KICKOFF.md` turns on the guardrail guard.
   After that, an agent asks before it edits a guardrail file. See
   [agent hooks](../../../docs/contributing/harness-engineering.md#agent-hooks).
3. Ask the owner to trust the project hooks in Codex with `/hooks`, if they
   use Codex.
4. Set up the scheduled agent that runs the
   [weekly gardening](../../../docs/contributing/harness-engineering.md#weekly-gardening)
   pass. Fill its slot with the agent, its day and its reviewer.

Pick the profile of each client app. The template ships Vite with TanStack
Router in `apps/web`. For a project with no client, delete `apps/web`,
`features/notes` and the React language entry. For a native profile, add the
app and fill the native slot in `docs/contributing/architecture/styling.md`.
Then add the SQLite adapter of the local database. Follow the steps in
[local database](../../../docs/contributing/architecture/client.md#local-database):
the driver at an exact version, its vendor entry, `runtime/sqlite.ts` in
`packages/sync`, and the composition root. A native app is not done until it keeps its pool in
SQLite.

A native profile also sets up [native builds and devices](../../../docs/contributing/setup/native.md):

1. Add `@expo/fingerprint` to the native app's devDependencies at an exact
   version. Install Maestro on the machine that runs the simulators.
2. Ask the owner which machine runs the simulators and how a session reaches
   it. Add that device host to `hosts` in `tools/native/device-host.ts`, with
   tests that use a fake, and fill the device host slot in
   `docs/contributing/setup/native.md`.
3. Record the first fingerprint with
   `mise exec -- bun run native:build <app> --record`, and commit
   `apps/<app>/native-fingerprint.json`.
4. Add a native journey for each feature:
   `features/<feature>/journeys/<id>.maestro.yaml`. It runs on the booted
   device through the device host.
Remove the notes example (`packages/notes`, `features/notes`, its route and its
registrations) once the first product package exists.

### 5. Close

1. Fill the slots in `AGENTS.md` and `docs/contributing/index.md`. Rewrite
   `README.md` for the product. Rename the root project in `package.json`.
2. Delete `KICKOFF.md` and its line in `AGENTS.md`. This turns on the
   guardrail guard.
3. Run `mise exec -- bun run validate`. The slot check is strict now. Each
   slot that is left belongs to a phase. Fill it from evidence or a default,
   ask the owner the open product question, or delete it when it does not
   apply.
4. Commit: `Define <project>: intent and architecture`.
