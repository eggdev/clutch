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
- [setup-verification](./setup-verification/SKILL.md): create or maintain the one
  committed verify executor and its journeys. This is the only authoring entry point.
- [verify](./verify/SKILL.md): execute this project's existing proof and cleanup.
- [audit-codebase](./audit-codebase/SKILL.md): investigate code risks and report findings.
- [run-lanes](./run-lanes/SKILL.md): coordinate agent lanes that deliver issues in
  parallel: split by file ownership, brief, reserve ids, merge in a train.
- [pr-recap](./pr-recap/SKILL.md): on explicit request, explain a PR diff. It adds
  no correctness gate or publication permission.
- kickoff (when installed): define or resume project setup; use recorded
  decisions before asking new questions.

Review-process gardening needs separately configured scope, retention and
execution. Copying these skills does not activate a background workflow.
