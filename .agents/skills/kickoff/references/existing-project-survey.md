# Existing project: survey

The install CLI starts this stage with `/kickoff survey`. Nobody watches it.
The CLI made a worktree on the branch `template/install` and copied the
template files into it. You prepare the interview, so that the owner spends
the session on decisions and corrections.

## Rules

1. **Ask nothing.** Nobody reads your output until the interview. Write each
   open question into the draft or the manifest entry that it belongs to.
2. **Change only the worktree.** Do not push, deploy or call a remote service
   of the project.
3. **Use only these commands.** The run denies all others:
   - `git log`, `git show`, `git diff`, `git status`, `git ls-files`,
     `git add` and `git commit`
   - `mise exec -- bun install`
   - `mise exec -- bun run validate`
   - `mise exec -- bun tools/check-<name>.ts` for each check in `tools/`
4. **Do not fix code.** The migration stage fixes code after the interview.
5. **The template is the default.** Recommend the template in every draft and
   every manifest entry. A project convention stays only when the owner gives
   a reason in the interview.
6. **Name the source of each fact:** a file, a commit or a vendor page. When
   you cannot read a vendor page, write the vendor question into the draft.

## Inputs

- `.template-install/manifest.json`. `base.commit` is the project before the
  install. `files` lists each file that the install added, replaced or merged.
  `conflicts` lists each value in `package.json` where the template won.
- The project before the install: `git show <base.commit>:<path>`, and
  `git ls-files` for the list of files.
- The history: `git log --stat`, to learn what changes often and who works on
  the project.

## Steps

### 1. Inventory

Read the project before you write anything:

1. Every Markdown file, and every agent instruction file. Look for
   `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/`, the Copilot
   instructions in `.github/` and each similar file. Read the base
   version of each file that the install replaced.
2. The code: the workspaces, apps and packages, their entry points, the tests,
   the scripts in each `package.json`, the CI workflows and the deploy config.
3. The tools that overlap a template mechanism: the package manager and its
   lockfile, linters, formatters, type checkers, test runners, Git hook
   managers, task runners and CI jobs.

### 2. Draft the slots

Run `mise exec -- bun tools/check-kickoff-slots.ts` for the list. Work through
the phases in [SKILL.md](../SKILL.md) in order, and use the
[question bank](./question-bank.md). For each slot, write a draft from what the
project shows. Keep the slot comment above the draft, and change its text to
the question that the owner must answer:

```md
<!-- kickoff: draft. Is the order history a hard invariant, or a report? -->

Orders never change after payment. A refund is a new order that points to the
original. Source: `src/orders/refund.ts`.
```

The interview deletes the comment when the owner agrees. Leave a slot as it is
when the project gives no evidence for it.

Draft the registry in `docs/contributing/architecture/primitives.yaml`: one
entry for each app and package. Run `mise exec -- bun tools/check-primitives.ts`
after each change.

### 3. Annotate the manifest

Add these fields to each `replaced` and `merged` entry in `files`, and to each
entry in `conflicts`:

- `summary`: what the project's version does, in one or two sentences
- `recommendation`: `template`, `combine` or `keep`
- `reason`: why, with the source

Recommend `template` unless the project's version does something that the
template does not. Then recommend `combine`: the template's version, with the
project's part added to it. Recommend `keep` only when the template's version
would break the product.

For each replaced doc or agent instruction file, also add `destinations`: a
list of the parts of the old content, each with the template page that owns
it, or `drop` with a reason.

Add an `overlaps` list to the manifest for the project files that the install
did not touch but that overlap a template mechanism, from step 1.3. Give each
entry a `path` and the same three fields.

### 4. Baseline

1. Run `mise exec -- bun install`. When it fails, record the error in the
   findings and skip the next step.
2. Run `mise exec -- bun run validate --output-style=static`. For each target,
   record if it passes, the number of errors and the number of files.

### 5. Principles

For each page in `docs/principles/`, find the places where the code breaks the
principle. Record the location, the evidence and the principle. Do not file
issues. The interview files them with the owner.

### 6. Findings

Write `.template-install/findings.md` with these sections:

- **Baseline:** one table row for each validate target
- **Violations:** one entry for each finding from step 5
- **Open questions:** the questions that do not fit a draft or a manifest entry
- **Limits:** what the survey could not check, and why

### 7. Hand off

Set `stage` in the manifest to `interview`. Commit all files with the message
`Install template: survey drafts`.

When you must stop before the end, commit what you have and leave `stage` as
`survey`. The next run continues: read the findings and the drafts first.
