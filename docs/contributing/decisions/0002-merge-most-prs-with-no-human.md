# 0002: Merge most PRs with no human, and tighten only on evidence

- **Status:** amended by [0003](./0003-a-pure-clutch-sync-takes-owner-findings-as-approved-upstream.md), [0005](./0005-the-owner-signs-off-what-cannot-be-paid-back.md)
- **Date:** 2026-11-02

## Context

Auto-merge reached the step `low` in v0.32.0 and merged no PR in its first
day. Risk tiers held every check script, workflow, skill and lint config for a
person, so 18 of the 24 PRs from #100 to #131 came out `one-way-door`. Brendan,
2026-11-02: "I want most work to be merged honestly. I should be driving the
product and making sure we're doing the things. Agents should be shipping. We
should start at 80% merges and make it more restrictive if needed not the
other way around."

## Decision

80% of PRs merge with no human, on Clutch and on each project. Rules start
permissive and tighten only on evidence. Only this hard core needs Brendan:

- The merge gate: the rulesets, CODEOWNERS, `.clutch/risk.yaml`, the guardrail
  list, the auto-merge script and workflow, agent review and its rules, and
  the `automerge` and `agentReview` sections of `clutch.yaml`.
- Credentials and secrets, and a workflow's `permissions:`, environment,
  secrets or privileged trigger.
- Auth and access, and migrations.
- Billing, and infra and deploy, which kickoff names for each project.
- Decision records and policy docs: this folder, `docs/principles`, project
  intent and `.clutch/PLAN.md`.

Everything else merges at the step `medium` once every check passes. A
model's finding holds no merge. That covers product code, docs, agent skills,
check scripts, lint config and other workflows. Two guards make it safe:

- A deterministic check, [weaker-journeys.ts](../../../tools/github/weaker-journeys.ts),
  finds a change that weakens a journey or a budget, whatever its path.
  Auto-merge leaves that PR for Brendan.
- When `main` turns red after an auto-merged PR, the Auto-revert workflow opens
  its revert PR. Each revert of an auto-merged PR files a `risk-tighten` issue
  that proposes to tighten its path. `clutch metrics` watches the share with
  no human, the revert rate, red-`main` minutes and those issues.

This amends [0001](./0001-allow-shrink-only-ratchets.md): the ratchet
baseline stays a guardrail file, and `check-ratchets` fails any count that
rises. That check, not a person, guards the baseline against a weaker count.

## Consequences

Agents ship most work without waiting for Brendan, and he reviews the hard
core and the PRs that weaken a journey or a budget. The guard against a weaker
check rests on that deterministic check, which covers only journeys and
budgets. The revert and the tighten issue catch what it misses, after the
merge. CODEOWNERS cannot express the line rules on workflows and
`clutch.yaml`, so for those auto-merge holds the PR, and GitHub does not
require an approval.

**Revisit if:** reverts pass 2% of merged PRs in a 30-day window, or a
`risk-tighten` issue names the same path twice. Tighten that path, or the
rule, first. The revert brake that stepped auto-merge down is gone: the owner removed it on
2026-11-08 (CL-454). A person still tightens the path from the `risk-tighten` issue.
