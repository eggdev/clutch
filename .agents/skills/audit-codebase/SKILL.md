---
name: audit-codebase
description: Investigate codebase security, correctness, performance, accessibility, data or analytics risks and return evidence-backed findings. Use for a scoped code audit. Does not deliver fixes or analyze cross-project review efficiency.
---

# Audit a codebase

Inputs: requested scope, suspected risks, project intent and current code.
Output: confirmed findings, rejected suspicions and explicit coverage gaps.
The task's configured tracker owns findings; use
[local task records](../deliver/references/task-records.md) when no writable tracker exists.

## Investigate

1. Read agent guidance, security policy, hard invariants and accepted risks.
   Challenge an accepted risk only with evidence that its revisit condition holds.
2. Record scope and each suspicion in the existing task. Search existing findings
   before adding one, so repeated audits do not create duplicate work.
3. Trace reachable code paths. Select the smallest real test or reproduction that
   could disprove the suspicion. For performance compare equivalent measured
   conditions; for UI check actual interaction, not only rendered strings.
   For analytics on PostHog follow [the analytics audit](references/analytics.md).
4. Separate an observed defect from a hypothesis or missing runtime prerequisite.
   Investigate technical uncertainty; ask the owner only for a product decision.
   Do not turn an unproven suspicion into a confirmed finding.
5. Stop and tell the owner immediately when a reachable defect breaks a hard
   invariant now. Preserve evidence; do not perform an unrequested live exploit.

## Record each finding

Use severity by impact: critical breaks a hard invariant now; high can break it
under a reachable condition; medium is a limited defect; low needs another
failure or has small user cost. A disproved suspicion is a coverage note.

For each confirmed finding record location, reproduction/code evidence, affected
user and impact, proposed fix, regression check and false-positive condition.
A finding without a reproducible runtime path may still have concrete source
evidence; label what was and was not exercised.

Use the configured tracker within existing authorization. External publication
and label creation are separate writes, not mandatory audit side effects.
Keep a local result when publication is unavailable or unrequested. Do not
hardcode GitHub when the project uses Linear.

## Handoff

Report coverage, findings in severity order, answers to suspicions and unrun
checks. Do not claim a clean audit from unavailable access. Keep task findings
out of durable architecture docs; promote only established system rules.

An audit alone does not authorize remediation. Hand selected fixes to deliver.
A fix that the owner already included in scope can proceed with its own
regression evidence. Review-process gardening has a different goal: improving
how reviews happen across projects while retaining project-specific ideas for
their own projects. Do not substitute this code audit for that workflow.
