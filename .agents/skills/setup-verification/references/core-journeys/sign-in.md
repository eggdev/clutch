# Sign in journey template

Copy this into `features/<feature>/journeys/sign-in.pw.ts`, and register it as a
verify flow. Replace each `<...>` and each selector with the project's real
ones. Keep the outcome names: they are the names in the
[core journey catalog](../../../../../docs/contributing/journeys/core.md#sign-in-sign-in).

Make a native copy as `features/<feature>/journeys/sign-in.maestro.yaml`, with the
same header and outcome names. Give each assertion `label: outcome <name>`.

```ts
/**
 * sign-in: A member signs out, and signs in again with their new account.
 * State: retained
 * Contract: docs/contributing/journeys/core.md
 * Actor and platform: the new account, web
 * Entry: the first screen, then its Sign in button
 * Prerequisites: the dev servers, and the vendors in test mode
 * Isolation and cleanup: each run makes a new account with a unique address. <how the project deletes it>
 * Core: sign-in
 *
 * | User action | Expected observation | Proof |
 * | --- | --- | --- |
 * | Sign up, then sign out | The first screen shows the Sign in button | `outcome('signed-out')` |
 * | Sign in with the new account | The user is signed in | `outcome('signed-in')` |
 * | Reload the page | The user is still signed in | `outcome('session-kept')` |
 *
 * Failure condition: a wrong password is refused (`wrong-password-refused`).
 * Driver: `mise exec -- bun run journey sign-in`
 * Evidence: the Playwright list output, and a trace and the axe report in `test-results/journeys/` on failure
 * Limits: <what this journey does not prove>
 */
import { test } from '@playwright/test';
import { accessible } from '@repo/journeys/testing/a11y';
import { outcomes } from '@repo/journeys/testing/outcome';

test('a member signs out, and signs in again with their new account', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Sign out' }).click();
  await outcome('signed-out', { url: '/', text: 'Sign in' });
  // Sign in with a wrong password, then with the right one.
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('<a wrong password>');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await outcome('wrong-password-refused', { text: '<the refusal, such as Wrong email or password.>' });
  await page.getByLabel('Password').fill('<a strong test password>');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await outcome('signed-in', { url: '<the first screen after sign-in>', text: '<its heading>' });
  await page.reload();
  await outcome('session-kept', { url: '<the first screen after sign-in>', text: '<its heading>' });
});
```
