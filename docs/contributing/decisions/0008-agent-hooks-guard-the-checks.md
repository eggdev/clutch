# 0008: Agent hooks run the checks while the agent works

- **Status:** accepted
- **Date:** 2026-10-28

## Context

The checks run in Git hooks and in CI. An agent learns about a failure only
when it commits or pushes, after many edits. Nothing stops an agent from
editing a guardrail file, such as `oxlint.config.ts` or a budget file, to make
a check pass. Claude Code and Codex both run hooks before and after a tool
call and at the end of a turn.

## Decision

The hook scripts live in `.agents/hooks/`. The Claude Code settings file and
the Codex hooks file both call the same scripts.

1. After each edit, a hook runs oxlint on the edited file and returns the
   errors to the agent.
2. At the end of each turn, a hook runs the checks for the affected projects.
   A failure blocks the end of the turn. The hook prints nothing on success.
3. Before an edit to a guardrail file, a hook asks the user for approval. On
   Codex, the hook refuses the edit and tells the agent to ask the user.

Approval for guardrail files starts when kickoff deletes `KICKOFF.md`. A
CODEOWNERS file names a person for each guardrail file, so a human reviews the
change at merge.

A scheduled agent does the [weekly gardening](../harness-engineering.md#weekly-gardening)
pass and opens small pull requests.

## Consequences

- An agent sees a lint error after the edit that caused it.
- "Done" means the checks pass, because the turn cannot end before they do.
- A check rejects the two hook files if they register different hooks.
- A user can still approve a change to a guardrail file. The merge review is
  the control that holds, because a prompt protects only one session.
- Test that a refusal blocks an edit on each tool version before trusting it.

**Revisit if:** agents bypass a hook in more than one session in twenty, or a
tool drops support for hooks.
