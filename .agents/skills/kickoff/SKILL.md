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
mise exec -- bun tools/check-kickoff-slots.ts
```

## Rules of the interview

1. **Checklist first.** Collect capability choices together using
   [the setup checklist](./references/setup-checklist.md). Options and toggles
   are welcome here.
2. **Then one product question at a time.** Number each question. Ask in prose
   and let the owner answer in their own words. Skip settled checklist choices;
   ask only about missing detail or a concrete conflict.
3. **Automate routine setup.** Follow the split in the checklist reference.
   Fill facts from evidence and apply supported defaults without confirmation.
   For product decisions, show a draft before asking what is wrong with it.
4. **Look up facts. Ask for decisions.** Before you ask, read the code, the
   docs and the vendor pages. Bring the price, the deploy model and the local
   test runtime with each vendor proposal. Never ask the owner for a fact you
   can find.
5. **Recommend firmly.** Give one recommendation and the reason. Close with a
   question that the owner can answer with "agreed".
6. **Start each turn with what you recorded.** One line: the decision and the
   file it went into. Then the next question.
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

The question bank for each phase is in
[references/question-bank.md](./references/question-bank.md). The opening
question of each phase is a prompt for a draft. It is not a script.

## Entry points

| Command            | Stage                                     | Read first                                                                    |
| ------------------ | ----------------------------------------- | ----------------------------------------------------------------------------- |
| `/kickoff`         | The interview, with the owner             | This page                                                                     |
| `/kickoff survey`  | Unattended: drafts before the interview   | [existing-project-survey.md](./references/existing-project-survey.md)         |
| `/kickoff migrate` | Unattended: makes `validate` pass after it | [existing-project-migrate.md](./references/existing-project-migrate.md)       |

The install CLI in `apps/cli/` runs each stage when it installs the template
into an existing project. When `.template-install/manifest.json` exists, the
project existed before the template. Read
[existing-project.md](./references/existing-project.md) before phase 0. It
changes phase 0, adds a Reconcile phase and changes phase 5.

## Phases

Do the phases in order. Capture setup choices before the product interview;
use the product intent and journeys to refine only choices they put in doubt.

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

Then fill two user pages from the walk: `docs/users/intro.md`, which says
what the product is and is not, and `docs/users/getting-started.md`, which
takes a new user to one first win, a useful result they can see. Fill `docs/users/privacy.md` after phase 3, when the data
inventory and the vendors are known.

### 3. Services

Output: the slots in `docs/contributing/architecture/` (the index, request
context, authorization, data storage, feature flags, API errors, soft
delete, MCP server, local-first sync and client performance), one page for
each other service with
real rules, the product entries in
`docs/contributing/architecture/primitives.yaml`, and a decision record for
each no.

Use the checklist to select capabilities from phase 2. Skip off and later
capabilities. Keep a chosen provider unless a concrete requirement conflicts;
research two or three vendors only where a provider choice is still open.
Then propose one with its owner module, its kind (service or domain), its
price at the owner's expected scale, and its local test runtime. Resolve missing
tenancy and storage details before the rest, because they are one-way doors.
Apply the checklist scope to template architecture prose as well as slots;
do not leave claims about disabled capabilities in the finished docs.

Write the registry entries as the owner agrees to each part:

1. A `primitives` entry for each service, domain and app. Give it a group, a
   kind, a one-line summary, its `code` roots and its `docs` pages.
2. A `vendors` entry on the service that owns each vendor. Only a service owns
   a vendor.
3. A `layers` entry for each shared language, such as a query builder or a UI
   framework, with the folders that may import it.
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
for the selected capabilities. Derive configuration, seed data, test coverage,
secret inventories and rollback commands from the code and agreed journeys.
Retain compatible existing framework, provider and deployment choices. Record
the results in the owning pages without asking the owner to approve each one.

Ask only for unresolved product requirements: theme, languages, accepted
security risks, support access, recovery needs and alert recipients. Use
sections 4 and 5 of the question bank as prompts for gaps, not a mandatory
interview. Known facts and applicable engineering defaults are work to do.

Set up the project's own Nx remote cache. Each project has its own worker and
R2 bucket, so one repository never reads another's cache:

1. Use the configured Cloudflare account, or ask when the account is unknown
   or ambiguous.
2. Rename the worker and its bucket to `<project>-nx-cache` in
   `apps/nx-cache/wrangler.jsonc` and `docs/contributing/setup/nx.md`.
3. Walk the owner through "Set up the cache" in `docs/contributing/setup/nx.md`.
   The owner runs the steps that need their account.
4. Confirm that a CI run reports remote cache hits. Until it does, the cache is
   not set up.

### 5. Close

1. Fill the slots in `AGENTS.md` and `docs/contributing/index.md`. Rewrite
   `README.md` for the product. Rename the root project in `package.json`.
2. Delete `KICKOFF.md` and its line in `AGENTS.md`.
3. Run `mise exec -- bun run validate`. The slot check is strict now. Each
   slot left belongs to a phase: fill it from evidence or a supported default,
   ask an unresolved product question, or delete it when inapplicable.
4. Commit: `Define <project>: intent and architecture`.
