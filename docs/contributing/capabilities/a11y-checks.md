# Accessibility checks in journeys (axe)

Each web journey runs axe on the pages it renders. A `serious` or `critical` violation fails the journey.

## Why

A journey already drives the real app through its main flows. That makes it the cheapest place to catch a button with no name, a field with no label or text with too little contrast. Unit tests render parts, not pages. A person who reviews a screenshot misses what a screen reader hears. The axe engine finds these defects with no false alarms at the `serious` and `critical` levels.

## Detection

`clutch doctor` reports this capability as present when a journey in `features/*/journeys/*.pw.ts` imports `@repo/journeys/testing/a11y`. See the `a11y_checks` entry in [the registry](./registry.yaml).

## How it works

`packages/journeys/testing/a11y.ts` exports `accessible(page, where)`. A journey imports it beside `test` and `expect` from `@playwright/test`:

```ts
import { expect, test } from '@playwright/test';
import { accessible } from '@repo/journeys/testing/a11y';

test('…', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await accessible(page, 'home');
});
```

Call it after each step that renders a new page or a new state, once the page shows what the step expects. It fails with one line for each violation, which names the rule, the elements it hit and a link to the rule's page. It also attaches the full axe report to the test, in `test-results/journeys/`.

The check has no way to skip a rule, so fix each defect it reports. A rule that must stay off needs the owner's decision, and a guardrail file that holds it. Add that file to the escape hatch table in [harness engineering](../harness-engineering.md#guardrail-files).

## Adopt

1. Import `accessible` from `@repo/journeys/testing/a11y` in each web journey.
2. Call `accessible(page, 'where')` after each step that renders a page.
3. Run `mise exec -- bun run journey --all`, and fix each violation it reports.
4. Set `a11y_checks` to `adopted` in `clutch.yaml`.

## Waive

Set `a11y_checks` to `waived` in `clutch.yaml` with a reason. This capability is extra, so a gap only warns. A waiver is reasonable when the project has no web journeys.
