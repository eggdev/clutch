---
name: audit
description: Audit the codebase for security, performance, accessibility and data risks, verify each finding against code and tests, and file one issue per finding. Use when the owner asks for an audit, a security review of the whole codebase, or a periodic health check.
---

# Audit

An audit finds risks that the checks do not catch yet. Its record is the issue
tracker: one issue per finding. The audit writes no report into `docs/`.

## Before you look

1. Read `docs/contributing/security.md`. Do not reopen an accepted risk. To
   challenge one, show that its revisit-if condition is true.
2. Read `docs/contributing/project-intent.md` and the architecture pages for the
   areas in scope. Know the hard invariants.
3. Write down the scope: the areas, and the owner's suspicions. Each suspicion
   gets an answer, confirmed or not, backed by code and tests.
4. Search the open issues with the `audit` label, so you do not file a finding
   twice.

## Severity

| Severity | Meaning                                                                                       |
| -------- | --------------------------------------------------------------------------------------------- |
| Critical | Breaks a hard invariant now: a cross-tenant read, a takeover without sign-in, lost data        |
| High     | Breaks a hard invariant under a condition that an attacker or a normal user can reach          |
| Medium   | A real defect with a limited blast radius, or a broken rule from `security.md`            |
| Low      | A weakness that needs another failure first, or a small cost to users                         |
| Note     | A suspicion that turned out correct and safe. Record it, so the next audit does not repeat it |

Stop and tell the owner at once about a Critical finding. Do not wait for the
end of the audit.

## Each finding

Verify a finding before you file it. Read the code path, and when you can,
write a failing test that shows it. A finding with no evidence is a question.
Ask the owner instead.

File each finding as an issue, with the labels `audit`, its severity and its
area (`security`, `performance`, `accessibility` or `data`):

```md
Title: <Severity>: <what is wrong, in the words of its effect>

**Location:** <files and functions>
**Evidence:** <the code path, the test, or the steps that show it>
**Impact:** <who is affected, and how>
**Fix:** <the change, or "fixed in #N">
**Check:** <the lint rule, test or check that keeps it fixed, or why none can>
**False-positive risk:** <what would make this finding wrong>
```

Use `gh issue create --title ... --body ... --label ...`. Create a missing label
with `gh label create` first.

## Fix in the same change

Fix a finding in the audit's own PR only when the fix is small, its risk is low
and a test proves it. Every other finding stays an issue.

## Turn findings into checks

A finding that a cheap check can catch becomes a check, in the change that
fixes it. See `docs/contributing/harness-engineering.md`. A finding that needs
reasoning stays a rule in `security.md` or a Bugbot rule.

## Report

Post a short summary in the PR, or in chat when there is no PR:

- The scope and the method
- One line for each finding: severity, title and issue link
- The answer to each suspicion
- What the audit did not cover

<!-- kickoff: How often the project runs an audit: before launch, each release, or each quarter. Delete this slot when the owner runs it only on request. -->
