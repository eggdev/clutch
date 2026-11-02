# 0001: Allow shrink-only ratchets for adopted repositories

- **Status:** accepted
- **Date:** 2026-11-02

## Context

The template turns each rule on everywhere at once, and it kept no baseline of
old violations, because a baseline goes stale. A repository that adopts
Clutch late, such as Bar Savvy, has hundreds of old violations. Fixing them in
one change is not possible, and turning the rule off lets new violations in.
Brendan decided that ratchets come back (CL-301).
[`.clutch/doctor-baseline.json`](../../../.clutch/doctor-baseline.json) and
[`tools/file-size-budgets.json`](../../../tools/file-size-budgets.json) already
work this way.

## Decision

A repository may keep a ratchet baseline for a rule that it adopts. The
template ships a zero baseline, and no lint baseline.

- The baseline counts violations for each file. A count may only go down.
- The check counts against the merge base, so a change cannot raise a count.
- A change that lowers a count lowers the baseline in the same change.
- The baseline is a guardrail file, so a person reviews each change to it.

## Consequences

An adopted repository can turn a rule on for new code at once, and pay down
old violations over time. The baseline must stay small and honest: a count
that rises fails the check, and a count that falls without an update fails it
too. CL-302 builds the engine, and CL-302b adds `clutch ratchet` and the
`check-ratchets` target.

**Revisit if:** a ratchet baseline keeps a count above zero for more than 90
days with no drop, which means the rule should be fixed at once or turned off.
