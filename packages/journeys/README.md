# Journeys

What web journeys share. A journey in `features/<feature>/journeys/*.pw.ts`
takes `test` from `@repo/journeys/testing/test`. It runs each journey on each
device, and measures its layout shifts, clicks, keys, axe results and timings.
A layout shift at the budget fails the run, and names the element that moved.
A journey runs once on each device, with no retry, so any failure fails the
run.
See [budgets](https://github.com/eggdev/clutch/blob/main/docs/contributing/end-to-end-testing.md#budgets).

A journey imports `accessible` from `@repo/journeys/testing/a11y`. `accessible(page, where)` runs axe and fails on
any violation. See
[accessibility checks](https://github.com/eggdev/clutch/blob/main/docs/contributing/capabilities/a11y-checks.md).

It also imports `snap` from `@repo/journeys/testing/visual`. `snap(page, name)`
captures the page on the device of the run, in light and dark. On GitHub
Actions it compares each shot with its baseline in `__screenshots__/` next to
the journey, and fails on a change. A snap name that `tools/flaky-tests.json`
quarantines for the journey warns instead of failing. A local run only writes the shots to
`test-results/visual/`. See
[screenshots](https://github.com/eggdev/clutch/blob/main/docs/contributing/setup/verification.md#screenshots).

A core journey imports `outcomes` from `@repo/journeys/testing/outcome`.
`const outcome = outcomes(page)` gives `outcome(name, expected)`, which checks
the page's path, a visible text or both, in a step named for the outcome. It records the time since the test started,
then runs axe on the page. A
journey with a `Core:` line asserts only through it. At the outcome where a
core journey's click budget ends, it fails a run over the budget. See the
[core journey catalog](https://github.com/eggdev/clutch/blob/main/docs/contributing/journeys/core.md).

A core journey reads email through `@repo/journeys/testing/inbox`:
`enterEmailCode` and `openEmailLink`. Each runs the command in `journeys.inbox`
of `clutch.yaml`. See the
[core journey catalog](https://github.com/eggdev/clutch/blob/main/docs/contributing/journeys/core.md#vendors-in-test-mode).

A journey reads what the app stores and calls what the app serves. `poolState`,
`records` and `settled` in `@repo/journeys/testing/pool` read the object pool
that the page keeps in IndexedDB. `callTool` in `@repo/journeys/testing/tools`
calls an agent tool through `/mcp`, as the organization of the page. See
[agent and pool](https://github.com/eggdev/clutch/blob/main/docs/contributing/end-to-end-testing.md#agent-and-pool).

The journey test also records the layout problems of its last page, as shown and
at the largest text size. These findings never fail a journey. `bun run verify`
prints them in one report. See
[screen findings](https://github.com/eggdev/clutch/blob/main/docs/contributing/end-to-end-testing.md#screen-findings)
and the [verify report](https://github.com/eggdev/clutch/blob/main/docs/contributing/setup/verification.md#verify-report).

A data journey, in `features/<feature>/journeys/*.journey.ts`, calls `journey(title, steps)`
from `testing/journey.ts`. Its steps come from the builders in `testing/steps.ts`. The web run
registers it as a test, and the native run compiles it with `toMaestro` in `tools/journeys/`.
`tool` and `holds` take the declarations of a contract, such as `createNote` in
`packages/notes/contract/notes.ts`, so a rename fails the type check.
`types/` holds the step types, and the click budget rule in `types/budget.ts`.
See [data journeys](https://github.com/eggdev/clutch/blob/main/docs/contributing/end-to-end-testing.md#data-journeys).

The runner and the Playwright config live in `tools/journeys/`. A feature may
import only packages, so the checks live here.
