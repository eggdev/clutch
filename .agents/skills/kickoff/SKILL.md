---
name: kickoff
description: Define a new project from the template in one grilling session with the owner. Interviews one question at a time about intent, users, journeys, services and the harness, then writes project intent, architecture pages, decision records and tools/lint/boundaries.json. Use when KICKOFF.md exists, or when the user says kickoff, define the project, or start a new project.
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

1. **One question at a time.** Number each question. Never ask two.
2. **No multiple choice.** Do not use a question tool with options. Ask in
   prose. The owner answers in their own words.
3. **Draft first.** Show your full draft of the section, then ask what is
   wrong with it. A correction is faster than an answer from nothing.
4. **Look up facts. Ask for decisions.** Before you ask, read the code, the
   docs and the vendor pages. Bring the price, the deploy model and the local
   test runtime with each vendor proposal. Never ask the owner for a fact you
   can find.
5. **Recommend firmly.** Give one recommendation and the reason. Close with a
   question that the owner can answer with "agreed".
6. **Start each turn with what you recorded.** One line: the decision and the
   file it went into. Then the next question.
7. **Write as you go.** Write each section into its file as soon as the owner
   agrees. Do not hold answers until the end.
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

## Phases

Do the phases in order. Intent comes first: every later answer depends on who
the users are.

### 0. Read

1. Read `AGENTS.md`, `KICKOFF.md`, `docs/contributing/project-intent.md` and
   `docs/principles/index.md`.
2. Read `git config user.name`. That is the owner unless they say otherwise.
3. If the repository has code beyond the template, survey it. Draft from the
   code, and ask only what the code cannot answer.
4. Ask one open question: "Tell me what you want to build. Who is it for,
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

### 3. Services

Output: the slots in `docs/contributing/architecture/` (the index, request
context, authorization, data storage, feature flags, API errors and soft
delete), one page for each other service with
real rules, `tools/lint/boundaries.json`, and a decision record for each no.

For each capability from phase 2 (sign-in, data storage, sync, files, email,
payments, AI, jobs, search, analytics), research two or three vendors first.
Then propose one with its owner module, its kind (service or domain), its
price at the owner's expected scale, and its local test runtime. Ask about the
tenancy and storage topology before the rest, because they are one-way doors.

When the owner rejects an option that the next agent would propose again,
write a decision record from `docs/contributing/decisions/0000-template.md` and
add it to the steering list.

### 4. Harness and operations

Output: the slots in `docs/contributing/setup/`, `docs/contributing/testing.md`,
`docs/contributing/end-to-end-testing.md`, `docs/contributing/security.md` and
`docs/contributing/operations/`, and `.github/workflows/ci.yml`.

Ask about the app framework and deploy target, environments (the default is
a preview for each PR and production on merge), seed data, user-facing
languages, test runners, and which CI steps the journeys need. Then walk the
security and operations pages: the security rules, the accepted risks, the
secret inventory, the operator accounts and the rollback commands.

Set up the project's own Nx remote cache. Each project has its own worker and
R2 bucket, so one repository never reads another's cache:

1. Ask which Cloudflare account hosts it.
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
   slot left belongs to a phase: ask its question, or delete the slot when the
   project has no such content.
4. Commit: `Define <project>: intent and architecture`.
