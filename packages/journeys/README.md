# Journeys

What web journeys share. A journey in `features/<feature>/journeys/*.pw.ts`
imports `accessible` from `@repo/journeys/testing/a11y`. `accessible(page, where)` runs axe and fails on
a `serious` or `critical` violation. See
[accessibility checks](https://github.com/eggdev/clutch/blob/main/docs/contributing/capabilities/a11y-checks.md).

It also imports `snap` from `@repo/journeys/testing/visual`. `snap(page, name)`
captures the page at a mobile and a desktop width, in light and dark. On GitHub
Actions it compares each shot with its baseline in `__screenshots__/` next to
the journey, and fails on a change. A snap name that `tools/flaky-tests.json`
quarantines for the journey warns instead of failing. A local run only writes the shots to
`test-results/visual/`. See
[screenshots](https://github.com/eggdev/clutch/blob/main/docs/contributing/setup/verification.md#screenshots).

The runner and the Playwright config live in `tools/journeys/`. A feature may
import only packages, so the checks live here.
