# Billing and checkout journey template

Copy this into `features/<feature>/journeys/billing-and-checkout.pw.ts`, and register it as a
verify flow. Replace each `<...>` and each selector with the project's real
ones. Keep the outcome names: they are the names in the
[core journey catalog](../../../../../docs/contributing/journeys/core.md#billing-and-checkout-billing-and-checkout).

Make a native copy as `features/<feature>/journeys/billing-and-checkout.maestro.yaml`, with the
same header and outcome names. Give each assertion `label: outcome <name>`.

```ts
/**
 * billing-and-checkout: A member on the free plan upgrades, then cancels.
 * State: retained
 * Contract: docs/contributing/journeys/core.md
 * Actor and platform: the new account on the free plan, web
 * Entry: the first screen, then the Upgrade button
 * Prerequisites: the dev servers, and the vendors in test mode
 * Isolation and cleanup: each run makes a new account with a unique address. <how the project deletes it>
 * Core: billing-and-checkout
 *
 * | User action | Expected observation | Proof |
 * | --- | --- | --- |
 * | Sign up, then tap Upgrade | The checkout shows the paid plan | `accessible` |
 * | Pay with the declined test card | Checkout refuses the card | `outcome('card-declined')` |
 * | Pay with the test card that succeeds | The paid plan shows | `outcome('plan-upgraded')` |
 * | Move the test clock to a renewal that fails | The account shows the failed renewal | `outcome('renewal-failed')` |
 * | Cancel the plan | The account is on the free plan | `outcome('plan-cancelled')` |
 *
 * Failure condition: a declined card is refused (`card-declined`), and a failed renewal shows (`renewal-failed`).
 * Driver: `mise exec -- bun run journey billing-and-checkout`
 * Evidence: the Playwright list output, and a trace and the axe report in `test-results/journeys/` on failure
 * Limits: <what this journey does not prove>
 */
import { test } from '@playwright/test';
import { accessible } from '@repo/journeys/testing/a11y';
import { outcomes } from '@repo/journeys/testing/outcome';

test('a member on the free plan upgrades, then cancels', async ({ page }) => {
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
  await outcome('card-declined', { text: 'Your card was declined' });
  await outcome('plan-upgraded', { text: '<the paid plan>' });
  // Move the payment provider's test clock to the renewal date.
  await outcome('renewal-failed', { text: 'Update your card' });
  await outcome('plan-cancelled', { text: 'Free plan' });
});
```
