# Contact support journey template

Copy this into `features/<feature>/journeys/contact-support.pw.ts`, and register it as a
verify flow. Replace each `<...>` and each selector with the project's real
ones. Keep the outcome names: they are the names in the
[core journey catalog](../../../../../docs/contributing/journeys/core.md#contact-support-contact-support).

Make a native copy as `features/<feature>/journeys/contact-support.maestro.yaml`, with the
same header and outcome names. Give each assertion `label: outcome <name>`.

```ts
/**
 * contact-support: A member sends a request to support, and support gets it.
 * State: retained
 * Contract: docs/contributing/journeys/core.md
 * Actor and platform: the new account, web
 * Entry: the first screen, then the button that opens support
 * Prerequisites: the dev servers, and the vendors in test mode
 * Isolation and cleanup: each run makes a new account with a unique address. <how the project deletes it>
 * Core: contact-support
 *
 * | User action | Expected observation | Proof |
 * | --- | --- | --- |
 * | Sign up, then open support | The request form shows | `accessible` |
 * | Send a request | A confirmation shows, and the support tool or inbox gets it | `outcome('support-request-sent')` |
 *
 * Failure condition: a request with no message is refused (`empty-request-refused`).
 * Driver: `mise exec -- bun run journey contact-support`
 * Evidence: the Playwright list output, and a trace and the axe report in `test-results/journeys/` on failure
 * Limits: <what this journey does not prove>
 */
import { test } from '@playwright/test';
import { accessible } from '@repo/journeys/testing/a11y';
import { outcomes } from '@repo/journeys/testing/outcome';

test('a member sends a request to support, and support gets it', async ({ page }) => {
  const outcome = outcomes(page);
  const email = `journey-${Date.now().toString(36)}@example.test`;

  // Sign up through the sign-up screens, from the entry.
  await page.goto('/');
  await accessible(page, 'first screen');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('<a strong test password>');
  await page.getByRole('button', { name: 'Create account' }).click();
  await outcome('signed-up', { url: '<the first screen after sign-up>', text: '<its heading>' });
  await accessible(page, 'signed up');

  // The steps of this journey, from the first screen after sign-up.
  await outcome('empty-request-refused', { text: 'Enter a message' });
  await outcome('support-request-sent', { text: 'We got your request' });
});
```
