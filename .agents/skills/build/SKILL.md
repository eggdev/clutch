---
name: build
description: Work through TODO.md without the owner until the code matches the docs. Implements each item test-first, runs validate, commits, and checks the item off, then takes the next one. Use after kickoff, or when the user says build, continue the build, or work through the TODO.
---

# Build

The docs are the spec. `TODO.md` is the plan. You work item by item until the
plan is empty, and you ask the owner only for what the docs do not decide.

## Read first

1. `AGENTS.md`, then `docs/contributing/project-intent.md`. The hard
   invariants are the business. Breaking one is the worst outcome.
2. `docs/principles/index.md`. Open each principle when an item touches it.
3. `docs/contributing/architecture/index.md` and
   `docs/contributing/decisions/index.md`. Do not reopen a decision without
   new facts.
4. `TODO.md`.

## The loop

For each unchecked item, in order:

1. Read the pages that own the item.
2. Write the failing test first. Use the highest seam: the end-to-end journey
   when the item completes one, otherwise the module's public interface.
3. Make it pass. Follow [import boundaries](../../../docs/contributing/import-boundaries.md).
   Add each new vendor to `tools/lint/boundaries.json`.
4. Run `mise exec -- bun run validate`. For a change a user can see, run the
   app and use it in a browser. Be picky about the UI.
5. Update the page that owns any behavior you changed.
6. Check off the item, and commit both in one commit.

Then take the next item. Do not stop to report progress between items.

## When the docs do not decide

- **Not a one-way door:** pick the option that the principles favor, write
  it in the page that owns it, and continue.
- **A product decision or a one-way door:** do not guess. Add the question
  under "Questions for the owner" in `TODO.md`, with your recommendation and
  the item it blocks. Skip to the next item that does not depend on it.
- **The docs are wrong or cannot be built as written:** the same. Never edit a
  doc to match code that disagrees with it.

Stop only when every remaining item is blocked by a question. Then give the
owner the questions, one at a time, each with your recommendation.

## Ground rules

- Work on the branch that `TODO.md` names. Do not push or open a PR until the
  owner asks.
- Tests are behavioral. No mocks of internal modules. Vendor fakes only where
  no local runtime exists. See
  [test the workflow](../../../docs/principles/test-the-workflow.md).
- Reproduce a bug end to end before you fix it. Fix lint failures, test
  failures and flaky tests when you see them, even when you did not cause them.
- Never hand-edit a generated file or `CHANGELOG.md`.

## Done

When every item is checked:

1. Run `mise exec -- bun run validate`.
2. Delete `TODO.md` in its own commit.
3. Tell the owner what works now and how to try it.
