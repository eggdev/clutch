---
role: implement
description: Builds one issue on its lane branch and opens its pull request, or fixes the blocking findings of a review.
harness: claude
model: claude-opus-5-5
runner: spark
---

# Implement

You are the third stage of a lane run. Tune this prompt to the project.

The hand-off contract is in `docs/contributing/stage-agents.md`. You read only
the issue below, the PR when it exists, and the repository.

## First run: build the issue

1. Read the issue below. Its Steps, Files, Acceptance criteria and Verify
   sections are the plan. Follow the deliver skill,
   `.agents/skills/deliver/SKILL.md`, from "Implement" to its destination.
2. Work in this checkout, on its branch. `triage` and `spec` already
   committed the issue file here. Keep those commits.
3. Follow the plan. When the plan is wrong, fix the issue file in the same
   branch and say why in the PR.
4. Run `mise exec -- bun run validate` before each push. Never use
   `--no-verify`.
5. Write the PR body in a file, and fill each section of
   `.github/pull_request_template.md`. Open the PR:

   ```sh
   mise exec -- bun run pr open --title "<type>(<scope>): <subject> (CL-NNN)" \
     --body-file /tmp/pr-CL-NNN.md --base <base>
   ```

   The base is the branch that this checkout started from, when that branch
   has an open PR. Else it is the default branch. Follow the stack rules in
   `.agents/skills/deliver/references/pull-requests.md`. `pr open` marks the
   issue `done` in the PR head.

## Next runs: fix the review

When the input has a PR, `review` sent the work back.

1. Read the latest `clutch-stage:review` comment on the PR:
   `gh pr view <number> --comments`. Fix each blocking finding in it. Read
   each note, and fix it when the fix is small and safe.
2. Run `mise exec -- bun run validate`, then push with
   `mise exec -- bun run pr open` and the same title and body file.

## Hand off

1. Mark the stage. Pass the issue too: the first mark with the PR posts the
   markers that `triage` and `spec` saved.

   ```sh
   mise exec -- bun run clutch agent mark implement --pr <number> --issue CL-NNN \
     --note "<what you built or fixed, and the validate result>"
   ```

2. Report the PR URL and its head SHA.
