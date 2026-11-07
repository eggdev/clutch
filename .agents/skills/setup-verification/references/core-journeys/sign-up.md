# Sign up journey template

Copy this into `features/<feature>/journeys/sign-up.pw.ts`, and register it as a
verify flow. Replace each `<...>` and each selector with the project's real
ones. Keep the outcome names: they are the names in the
[core journey catalog](../../../../../docs/contributing/journeys/core.md#sign-up-sign-up).

Make a native copy as `features/<feature>/journeys/sign-up.maestro.yaml`, with the
same header and outcome names. Give each assertion `label: outcome <name>`.

```ts
/**
 * sign-up: A visitor makes an account on the free plan from the first screen.
 * State: retained
 * Contract: docs/contributing/journeys/core.md
 * Actor and platform: a visitor with no account, web
 * Entry: the first screen, then its Sign up button
 * Prerequisites: the dev servers, and the vendors in test mode
 * Isolation and cleanup: each run makes a new account with a unique address. <how the project deletes it>
 * Core: sign-up
 *
 * | User action | Expected observation | Proof |
 * | --- | --- | --- |
 * | Open the first screen and tap Sign up | The sign-up form shows | `accessible` |
 * | Fill the form with a unique address and submit | The user is signed in on the first screen after sign-up | `outcome('signed-up')` |
 * | Open the link in the test inbox | The address shows as verified | `outcome('email-verified')` |
 *
 * Failure condition: an address that has an account is refused (`email-taken-refused`), and so is a weak password (`weak-password-refused`).
 * Driver: `mise exec -- bun run journey sign-up`
 * Evidence: the Playwright list output, and a trace and the axe report in `test-results/journeys/` on failure
 * Limits: <what this journey does not prove>
 */
import { test } from '@repo/journeys/testing/test';
import { accessible } from '@repo/journeys/testing/a11y';
import { outcomes } from '@repo/journeys/testing/outcome';

test('a visitor makes an account on the free plan from the first screen', async ({ page }) => {
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
  await page.getByRole('button', { name: '<the step that leads to email-verified>' }).click();
  await outcome('email-verified', { text: 'Email verified' });
  // Failure states: sign up again with the same address, then with a weak password.
  await page.getByRole('button', { name: '<the step that leads to email-taken-refused>' }).click();
  await outcome('email-taken-refused', { text: '<the whole refusal, such as That email already has an account.>' });
  await page.getByRole('button', { name: '<the step that leads to weak-password-refused>' }).click();
  await outcome('weak-password-refused', { text: 'Use a longer password' });
});
```
