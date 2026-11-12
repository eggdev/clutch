---
name: system-review
description: Score how well this project ships scoped work with its owner hands off, then pick the changes that save the owner the most time. A council of one strong model from each provider reviews the code against one fixed scale, and the scores go in a history file. Use it when asked for a council review of the system, and as the way to choose the next improvement to the harness. Skip it for a review of one pull request.
---

# System review

This is how the project improves itself. Each run scores the same lines on the
same scale, so two runs can be compared. Read
[proof gates code](../../../docs/principles/proof-gates-code.md) first. It says
when the owner stops, and the review measures the code against it.

## Run one round

1. Fix what you already know: open PR comments and failing checks. A council
   should not spend a round on a known bug.
2. Copy [the brief](./references/brief.md). Fill in only the checkout and its
   head commit. Never add your own fixes, your theory or the last round's
   findings. A brief that changes makes the scores incomparable.
3. Start one member for each provider, with the same brief, read-only and at
   high effort. Report it when fewer than three providers are available. Do
   not substitute a second model from one provider.
4. Read each answer against the code. Keep a score only when it cites a file
   and line. Reject a claim that the code contradicts, and say why.
5. Add one row for each member to
   [the history](../../../docs/contributing/system-reviews.md).

## Choose the changes

- A change becomes work only when it fails a line of the scale. A concern
  that fails no line is not work.
- Rank the changes by the owner's time they save. Take at most 5.
- Prefer removing a step. Do not add a system where a change to one works.
- Show the owner the scores, the disagreements and your picks. Ask only what
  the owner must decide. Then file one issue for each change, and
  [deliver](../deliver/SKILL.md) it.

## Stop

- Run a new round only after a change merges. A round on unchanged code
  measures noise.
- After 2 rounds with no higher overall score, stop and bring the owner the
  result. Rising scores are not the goal: the owner's time is.
- A reviewer who finds defects in code the last round added is a sign to cut
  that code, not to patch it.
