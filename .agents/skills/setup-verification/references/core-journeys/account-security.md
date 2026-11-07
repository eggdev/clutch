# Account security journey template

Copy this into `features/<feature>/journeys/account-security.pw.ts`, and register it as a
verify flow. Replace each `<...>` and each selector with the project's real
ones. Keep the outcome names: they are the names in the
[core journey catalog](../../../../../docs/contributing/journeys/core.md#account-security-account-security).

Make a native copy as `features/<feature>/journeys/account-security.maestro.yaml`, with the
same header and outcome names. Give each assertion `label: outcome <name>`.

```ts
/**
 * account-security: A member changes their password, and resets a forgotten one.
 * State: retained
 * Contract: docs/contributing/journeys/core.md
 * Actor and platform: the new account, web
 * Entry: the first screen, then the button that opens security settings
 * Prerequisites: the dev servers, and the vendors in test mode
 * Isolation and cleanup: each run makes a new account with a unique address. <how the project deletes it>
 * Core: account-security
 *
 * | User action | Expected observation | Proof |
 * | --- | --- | --- |
 * | Sign up, open security settings and change the password | The new password signs in | `outcome('password-changed')` |
 * | Sign out, and use the reset link in the test inbox | A new password signs in | `outcome('password-reset')` |
 *
 * Failure condition: a wrong current password is refused (`wrong-password-refused`).
 * Driver: `mise exec -- bun run journey account-security`
 * Evidence: the Playwright list output, and a trace and the axe report in `test-results/journeys/` on failure
 * Limits: <what this journey does not prove>
 */
import { test } from '@playwright/test';
import { accessible } from '@repo/journeys/testing/a11y';
import { outcomes } from '@repo/journeys/testing/outcome';

test('a member changes their password, and resets a forgotten one', async ({ page }) => {
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
  await page.getByRole('button', { name: '<the step that leads to wrong-password-refused>' }).click();
  await outcome('wrong-password-refused', { text: 'Wrong password' });
  await page.getByRole('button', { name: '<the step that leads to password-changed>' }).click();
  await outcome('password-changed', { text: 'Password changed' });
  await page.getByRole('button', { name: '<the step that leads to password-reset>' }).click();
  await outcome('password-reset', { text: 'Welcome' });
});
```
