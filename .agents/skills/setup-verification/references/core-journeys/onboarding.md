# Onboarding journey template

Copy this into `features/<feature>/journeys/onboarding.pw.ts`, and register it as a
verify flow. Replace each `<...>` and each selector with the project's real
ones. Keep the outcome names: they are the names in the
[core journey catalog](../../../../../docs/contributing/journeys/core.md#onboarding-onboarding).

Make a native copy as `features/<feature>/journeys/onboarding.maestro.yaml`, with the
same header and outcome names. Give each assertion `label: outcome <name>`.

```ts
/**
 * onboarding: A new user finishes onboarding and reaches the activation event.
 * State: retained
 * Contract: docs/contributing/journeys/core.md
 * Actor and platform: the new account, just after sign-up, web
 * Entry: the first screen after sign-up
 * Prerequisites: the dev servers, and the vendors in test mode
 * Isolation and cleanup: each run makes a new account with a unique address. <how the project deletes it>
 * Core: onboarding
 *
 * | User action | Expected observation | Proof |
 * | --- | --- | --- |
 * | Sign up | The first onboarding step shows | `outcome('signed-up')` |
 * | Leave during a step and come back | The same step shows | `outcome('onboarding-resumed')` |
 * | Finish each step | The activation event happens | `outcome('onboarded')` |
 *
 * Failure condition: an empty field that a step needs is refused (`required-field-refused`).
 * Driver: `mise exec -- bun run journey onboarding`
 * Evidence: the Playwright list output, and a trace and the axe report in `test-results/journeys/` on failure
 * Limits: <what this journey does not prove>
 */
import { test } from '@playwright/test';
import { accessible } from '@repo/journeys/testing/a11y';
import { outcomes } from '@repo/journeys/testing/outcome';

test('a new user finishes onboarding and reaches the activation event', async ({ page }) => {
  const outcome = outcomes(page);
  const email = `journey-${Date.now().toString(36)}@example.test`;

  // Sign up through the sign-up screens, from the entry.
  await page.goto('/');
  await accessible(page, 'first screen');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('<a strong test password>');
  await page.getByRole('button', { name: 'Create account' }).click();
  await outcome('signed-up', { text: 'Welcome' });
  await accessible(page, 'signed up');

  // The steps of this journey, from the first screen after sign-up.
  await outcome('required-field-refused', { text: 'This field is required' });
  await page.reload();
  await outcome('onboarding-resumed', { text: 'Step 2' });
  await outcome('onboarded', { text: '<the activation event>' });
});
```
