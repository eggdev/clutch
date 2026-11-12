# Accessibility checks in journeys (axe)

Each web journey runs axe on the pages it renders. Any violation fails the journey, `minor` included.

## Why

A journey already drives the real app through its main flows. That makes it the cheapest place to catch a button with no name, a field with no label or text with too little contrast. Unit tests render parts, not pages. A person who reviews a screenshot misses what a screen reader hears. The policy is no accessibility error, so `accessible()` in `packages/journeys/testing/a11y.ts` fails at every impact level.

## Detection

`clutch doctor` reports this capability as present when a journey in `features/*/journeys/*.pw.ts` imports `@repo/journeys/testing/a11y`. A data journey in `features/*/journeys/*.journey.ts` counts when it has an `accessible(...)` step. See the `a11y_checks` entry in [the registry](./registry.yaml).

## How it works

`packages/journeys/testing/a11y.ts` exports `accessible(page, where)`. A journey imports it beside `test` from `@repo/journeys/testing/test` and `expect` from `@playwright/test`:

```ts
import { expect } from '@playwright/test';
import { accessible } from '@repo/journeys/testing/a11y';
import { test } from '@repo/journeys/testing/test';

test('…', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await accessible(page, 'home');
});
```

Call it after each step that renders a new page or a new state, once the page shows what the step expects. In a core journey, `outcome()` runs it after each outcome holds. The journey test also runs it on the last page, and keeps each result in the journey's [measures](../end-to-end-testing.md#measures). A violation on any try fails the run, also when the retry passes. It fails with one line for each violation, which names the rule, the elements it hit and a link to the rule's page. It also attaches the full axe report to the test, in `test-results/journeys/`.

The check has no way to skip a rule, so fix each defect it reports. A rule that must stay off needs the owner's decision, and a guardrail file that holds it. Add that file to the escape hatch table in [harness engineering](../harness-engineering.md#guardrail-files).

## Adopt

1. Import `accessible` from `@repo/journeys/testing/a11y` in each web journey.
2. Call `accessible(page, 'where')` after each step that renders a page.
3. Run `mise exec -- bun run journey --all`, and fix each violation it reports.
4. Set `a11y_checks` to `adopted` in `clutch.yaml`.

## Waive

Set `a11y_checks` to `waived` in `clutch.yaml` with a reason. This capability is extra, so a gap only warns. A waiver is reasonable when the project has no web journeys.
