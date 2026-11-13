# 0006: No cap on the blocking checks, no not-doing list and no monthly target

- **Status:** accepted
- **Date:** 2026-11-13

## Context

[Exact](https://github.com/expo/exact) lets six checks block a change, and a seventh needs one deleted in the same change. Its `rules/DEFERRED.md` is a binding list of work that it does not do yet. CL-527 asked whether Clutch takes both.

On 2026-11-13, Clutch blocked on 44 targets: 7 in `tools/validate.ts` and 38 under `checks` in `package.json`, with `skill-tests` in both lists. About 8 of them hold prose. The plan asked for more: the exit metric of phase P4 said "Friction turns into at least one new check a month."

The owner compared the two projects. Exact is built so that its own form removes many mistakes of ordinary application development. Clutch builds on ordinary tools, so its checks do that work.

## Decision

We will not cap the number of blocking checks, and the checks on prose keep blocking. A check stays for one reason only: it stops a mistake that an agent makes for real. A check that exists only for coverage goes. The owner reviews each check against that reason (CL-549).

We will not keep a not-doing list. The `later` phase of the tracker names the work that waits, and each issue there names its trigger.

We will not set a target for new checks or for fixes in a month. A target makes an agent invent the work. Agents record friction with `clutch friction add`, and the weekly digest shows it to the owner, who decides what becomes work (CL-486).

A new check target names the check that it replaces, or it says why none can go.

In a session, a change to a rule comes from the owner, or the owner allows the session to make it. Agents write and edit rules as the work goes on. This adds no hold to a pull request, so [record 0005](./0005-the-owner-signs-off-what-cannot-be-paid-back.md) stands.

## Consequences

The count of checks can grow, and the time of `validate` grows with it. `clutch metrics` reports that time, and no check blocks on it.

The rule for a session depends on the agent today. The hook `tools/agent-hooks/guard-guardrails.ts` asks the owner before an edit to a guardrail file. A shell command gets past it, and it lets each edit through while `KICKOFF.md` exists. CL-916 closes these gaps after the P5 work.

No list tells an agent what not to build. The contract, the principles and these records do that work.

**Revisit if:** the p50 of the validate step in `clutch metrics` passes 120 seconds, or the owner's review (CL-549) removes more than a quarter of the checks. Then decide on a cap again, with those numbers.
