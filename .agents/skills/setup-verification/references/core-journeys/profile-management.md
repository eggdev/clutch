# Profile management journey template

Copy this into `features/<feature>/journeys/profile-management.pw.ts`, and register it as a
verify flow. Replace each `<...>` and each selector with the project's real
ones. Keep the outcome names: they are the names in the
[core journey catalog](../../../../../docs/contributing/journeys/core.md#profile-management-profile-management).

Make a native copy as `features/<feature>/journeys/profile-management.maestro.yaml`, with the
same header and outcome names. Give each assertion `label: outcome <name>`.

```ts
/**
 * profile-management: A member changes their name and email address.
 * State: retained
 * Contract: docs/contributing/journeys/core.md
 * Actor and platform: the new account, web
 * Entry: the first screen, then the button that opens the profile
 * Prerequisites: the dev servers, and the vendors in test mode
 * Isolation and cleanup: each run makes a new account with a unique address. <how the project deletes it>
 * Core: profile-management
 *
 * | User action | Expected observation | Proof |
 * | --- | --- | --- |
 * | Sign up, then open the profile | The profile form shows | `accessible` |
 * | Change the name, save and reload | The new name shows | `outcome('profile-saved')` |
 * | Change the address, and open the link in the test inbox | The new address shows | `outcome('email-changed')` |
 *
 * Failure condition: a value that the form does not take is refused (`invalid-field-refused`).
 * Driver: `mise exec -- bun run journey profile-management`
 * Evidence: the Playwright list output, and a trace and the axe report in `test-results/journeys/` on failure
 * Limits: <what this journey does not prove>
 */
import { test } from '@playwright/test';
import { accessible } from '@repo/journeys/testing/a11y';
import { outcomes } from '@repo/journeys/testing/outcome';

test('a member changes their name and email address', async ({ page }) => {
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
  await page.getByRole('button', { name: '<the step that leads to invalid-field-refused>' }).click();
  await outcome('invalid-field-refused', { text: 'Enter a valid name' });
  await page.getByRole('button', { name: '<the step that leads to profile-saved>' }).click();
  await outcome('profile-saved', { text: '<the new name>' });
  await page.getByRole('button', { name: '<the step that leads to email-changed>' }).click();
  await outcome('email-changed', { text: '<the new address>' });
});
```
