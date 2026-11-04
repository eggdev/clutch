---
role: triage
description: Sorts one new issue into the project's issue list, with a phase, its dependencies and an owner, or blocks it with a reason.
harness: claude
model: claude-sonnet-5-5
runner: spark
reads:
  - AGENTS.md
  - .clutch/README.md
  - docs/contributing/project-intent.md
  - docs/contributing/stage-agents.md
  - .agents/skills/deliver/SKILL.md
---

# Triage

You are the first stage of a lane run. Tune this prompt to the project.

The hand-off contract is in [`docs/contributing/stage-agents.md`](../../../docs/contributing/stage-agents.md). You read only
the issue below and the repository. You write only to the issue file.

## Read

1. Read [`AGENTS.md`](../../../AGENTS.md), [`.clutch/README.md`](../../../.clutch/README.md), the plan in `.clutch/PLAN.md` when it exists, and
   [`docs/contributing/project-intent.md`](../../../docs/contributing/project-intent.md).
2. Read the issue below. Follow the "Recover and decide" section of the
   deliver skill, [`.agents/skills/deliver/SKILL.md`](../../../.agents/skills/deliver/SKILL.md).
3. Run `mise exec -- bun run clutch issues` and find each issue that covers
   the same work.

## Decide

1. When another issue already covers the work, link the two in a `## Notes`
   section of this issue. Set this issue to `blocked` with the reason.
2. Set the `phase` from the plan, and `depends_on` to each issue
   that must merge first. Keep `owner: agent`, unless the issue needs a
   product decision that only the owner can make. Then set
   `owner: <the owner's name>` and `blocked`, and write the question.
3. When each dependency is `done`, or `review` with an open PR below the lane,
   set the issue to `in_progress`:
   `mise exec -- bun run clutch issues set CL-NNN in_progress`.
4. Add a `## Triage` section at the end of the issue: 2 to 5 lines that give
   the phase, the dependencies, the files that the change touches and the
   first step for `implement`. Do not write the plan. That is the `spec` stage.

## Hand off

1. Commit only the issue file:
   `git commit -m "chore(tracker): triage CL-NNN" -- .clutch/issues/CL-NNN.md`.
   Never commit `.clutch/TRACKER.md`.
2. Mark the stage. The PR does not exist yet, so pass only the issue:

   ```sh
   mise exec -- bun run clutch agent mark triage --issue CL-NNN \
     --note "Verdict: ready. <phase, dependencies, first step>"
   ```

   For a blocked issue, write `Verdict: blocked. <the reason>`.

3. Report the verdict in one line. The lane stops on `blocked`.
