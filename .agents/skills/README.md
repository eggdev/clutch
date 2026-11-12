# Repository skills

Use these local paths when a same-named global skill is also installed. This
repository owns these versions; updates include referenced files, helpers and
tests together. Git history records their provenance. Do not silently overwrite
global skills or other repositories when maintaining this suite.

- [deliver](./deliver/SKILL.md): own one task through its authorized destination.
  Its [command index](./deliver/references/commands.md) names the repeatable
  command for each step.
- [deliver-linear](./deliver-linear/SKILL.md): claim and dispatch a Linear issue,
  then apply its status and review gates around deliver.
- [system-review](./system-review/SKILL.md): score how well the project ships with
  its owner hands off, and pick the next changes.
- [setup-verification](./setup-verification/SKILL.md): create or maintain the one
  committed verify executor and its journeys. This is the only authoring entry point.
- verify: execute this project's existing proof and cleanup. The project generates
  `.agents/skills/verify/SKILL.md`, so sync does not ship it.
- [audit-codebase](./audit-codebase/SKILL.md): investigate code risks and report findings.
- [babysit-pr](./babysit-pr/SKILL.md): drive one open PR to green: classify each
  failure, rerun a flaky job once, fix real ones, answer findings, stop after 3 rounds.
- [run-lanes](./run-lanes/SKILL.md): coordinate agent lanes that deliver issues in
  parallel: split by file ownership, brief, reserve ids, merge in a train.
- [design-proposal](./design-proposal/SKILL.md): show today's screen next to 2 or 3
  directions in the app, let the owner pick one, build against it, then retire it.
- [pr-recap](./pr-recap/SKILL.md): on explicit request, explain a PR diff. It adds
  no correctness gate or publication permission.
- kickoff (when installed): define or resume project setup; use recorded
  decisions before asking new questions.

Review-process gardening needs separately configured scope, retention and
execution. Copying these skills does not activate a background workflow.
