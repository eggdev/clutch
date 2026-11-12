# 0003: A pure Clutch sync takes owner findings as approved upstream

- **Status:** superseded by [0005](./0005-the-owner-signs-off-what-cannot-be-paid-back.md)
- **Date:** 2026-11-03
- Since CL-472 no `owner` finding holds a PR, so this exception has nothing left to lift.

## Context

When Clutch releases, the release bot opens one sync PR in each project, on the
`clutch-sync/latest` branch ([clutch-sync.yml](../../../.github/workflows/clutch-sync.yml)).
The sync rule in [bot-rule.ts](../../../tools/github/bot-rule.ts) lets it merge
at the step `bots` only when it changes what `clutch sync` writes, and the
`clutch / doctor` check proves that the managed files match the release.

A release that changes a gate, such as a check script or a workflow, reaches
each project as that sync. Agent review in the project then raises the change
again as an `owner` finding. Under [0002](./0002-merge-most-prs-with-no-human.md),
any owner finding holds the PR. So each gate change costs one owner approval
per project, for a change that the owner already approved in Clutch. Neighborhood
#53 had 5 such findings, all already approved in Clutch.

## Decision

A Clutch sync PR takes its `owner` findings as approved upstream, so they hold
nothing, when all three hold:

1. The release bot opened it, on a `clutch-sync/` branch.
2. Its diff passes the sync rule.
3. The `clutch / doctor` check succeeded on its head. No ruleset requires
   that check, so auto-merge reads its conclusion itself.

The verdict still lists those findings, under "Owner findings, approved upstream
in Clutch". A failed required check or a blocking finding still holds the PR.
Every other PR keeps its owner findings: an agent PR, a sync with a file that
`clutch sync` does not write, and a sync whose doctor check is missing, pending
or failed.

## Consequences

The owner reviews a gate change once, in Clutch, at the release. A project's
own gate change, and any edit beyond the sync, still need the owner. An edit to
a managed file in the project makes sync stop and ask for a decision, so it
opens no PR and never reaches this exception.

This narrows [0002](./0002-merge-most-prs-with-no-human.md) for projects. Its
owner-finding guard holds every project PR except a pure Clutch sync. Clutch
itself has no sync, so 0002 is unchanged there.

A project that wants to review each sync can turn off auto-merge for it. No
switch covers the sync bot alone. `automerge.mode: dry-run` in `clutch.yaml`
stops every auto-merge in the project, the sync's included, and
`gh pr merge --disable-auto <number>` stops one queued merge. Setting
`template.mode` to anything but `sync` stops the sync PRs altogether.

**Revisit if:** two reverts of pure sync PRs, or two `risk-tighten` issues for
a managed path that a sync changed, fall in one 30-day window. Then drop this
exception, so owner findings hold every sync again.
