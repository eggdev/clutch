# The proposal record

Copy this into `docs/design/proposals/<slug>.md`. The slug names the screen,
such as `change-order-approval`. `bun tools/check-proposals.ts` reads the
frontmatter.

```md
---
title: Change order approval
status: proposed # proposed | adopted | current | historical
date: 2026-11-03 # the day the proposal opened
issue: CL-218 # the issue for the work
screen: features/change-order-approval/screens/approval-screen.tsx
prototype: apps/app/lib/gallery/proposals/change-order-approval.tsx
gallery: /gallery/proposals # the route that shows the directions
directions: [today, a, b, c]
adopted: '' # the chosen letter, once adopted
decided: '' # the date of the owner's choice
retired: '' # historical only: why, or the record that replaced it
---

# Change order approval

## Problem

Who uses the screen, the job they do there, and what is wrong with today, in
two or three sentences.

## Directions

### Today

What the screen does now. The baseline.

### A: <name>

The bet: what it makes easier, and what it costs. Any new component it needs.

### B: <name>

### C: <name>

## Screenshots

The PR that holds them, or the folder where the project keeps baselines.

## Decision

Empty while proposed. Then the owner's answer, quoted, with its date and link.

## Spec

Empty while proposed. Then the lines that each build PR is checked against:
the order of the content, the components, the primary action, each state and
each width.
```

Keep the record short. The prototype shows the design. The record says why,
and what to check.
