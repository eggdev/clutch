# Existing project: interview

Read this page when `.template-install/manifest.json` exists. The project
existed before the template. The survey stage drafted the slots, annotated the
manifest and wrote `.template-install/findings.md`. The rules of the interview
in [SKILL.md](../SKILL.md) apply. This page changes phase 0, adds a Reconcile
phase after phase 4 and changes phase 5.

Retain established project choices unless a concrete requirement conflicts.
Use template defaults for gaps. Record evidence and resolve actual conflicts;
do not require the owner to justify compatible providers or conventions.

## Follow-up after a migration

When the findings have a section **Migration: open**, the migration stopped on
items that need the owner. Walk only those items. Record each decision as the
Reconcile phase does. Then set `stage` to `migrate`, commit, and tell the owner
to run the install CLI again.

## Phase 0: Read

This replaces steps 4 and 5 of phase 0 in SKILL.md:

1. Read the manifest, the findings and each draft. A draft is a slot whose
   text starts with `draft.`.
2. Show the owner the survey in one short table: each validate target with its
   error count, the number of manifest entries to reconcile, and the number of
   violations.
3. Present the evidence-based [setup checklist](./setup-checklist.md) from the
   survey. Let the owner accept or edit it in one reply. Distinguish current
   behavior from requested changes; an off choice does not authorize removal
   of existing behavior. Record changes as decisions for reconciliation.
4. Start phase 1 with the first unresolved product draft.

## Phases 1 to 4

Fill verified facts and compatible setup defaults directly, removing their
slot comments. For unresolved product decisions, show the draft and ask what
is wrong with it. Replace those comments when the owner agrees.

When a phase reaches a page that a manifest entry lists in `destinations`,
bring that part of the old content into the draft for the page.

## Reconcile

Walk the manifest one entry at a time: each `replaced` and `merged` file, each
entry in `conflicts` and each entry in `overlaps`. Do the package manager
first, then linting and formatting, tests, Git hooks and CI, then the rest.

For each entry:

1. Show the project's version, the template's version, the survey summary and
   the recommendation.
2. Resolve compatible keep/combine choices and routine defaults directly.
   Ask the owner only when a conflict needs a product decision, changes
   behavior or requires a tradeoff. "Agreed" accepts that recommendation.
3. Write `resolution` (`template`, `combine` or `keep`) and a one-line `note`
   into the entry.
4. For `combine` and `keep`, write a decision record from
   `docs/contributing/decisions/0000-template.md`. Name what stays and why, so
   that a later agent does not remove it.
5. Apply a configuration change at once. Get the project's version with
   `git show <base.commit>:<path>`. Leave code changes to the migration.

Rules for the common entries:

- **Agent instructions.** `AGENTS.md` stays the template's index, at 20 lines
  or less. Move each rule from the old instruction files to the page that owns
  it, or drop it with the owner's agreement. Then delete each old instruction
  file that the template does not have.
- **CI.** Keep a project job that the template does not have as an Nx target,
  so that `validate` runs it. Keep deploy workflows unless the owner moves
  them to the template's model.
- **Violations.** Show the list from the findings, and ask once if you may
  file them. File each one as the audit skill does, in
  [its format](../../audit/SKILL.md#each-finding).

## Close

This replaces phase 5 in SKILL.md:

1. Fill the slots in `AGENTS.md` and `docs/contributing/index.md`. Keep the
   project's `README.md`, and add a link to the contributor docs.
2. Delete `KICKOFF.md` and its line in `AGENTS.md`.
3. Run `mise exec -- bun tools/check-kickoff-slots.ts`. No slots may remain.
4. Do not run `validate`. The migration makes it pass.
5. Set `stage` in the manifest to `migrate`. Commit:
   `Define <project>: intent and architecture`.
6. Tell the owner to run the install CLI again to start the migration.
