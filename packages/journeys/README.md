# Journeys

What web journeys share. A journey in `features/<feature>/journeys/*.pw.ts`
imports `accessible` from `@repo/journeys/testing/a11y`. `accessible(page, where)` runs axe and fails on
a `serious` or `critical` violation. See
[accessibility checks](https://github.com/eggdev/clutch/blob/main/docs/contributing/capabilities/a11y-checks.md).

The runner and the Playwright config live in `tools/journeys/`. A feature may
import only packages, so the check lives here.
