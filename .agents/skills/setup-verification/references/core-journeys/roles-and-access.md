# Roles and access journey template

Copy this into `features/<feature>/journeys/roles-and-access.pw.ts`, and register it as a
verify flow. Replace each `<...>` and each selector with the project's real
ones. Keep the outcome names: they are the names in the
[core journey catalog](../../../../../docs/contributing/journeys/core.md#roles-and-access-roles-and-access).

Make a native copy as `features/<feature>/journeys/roles-and-access.maestro.yaml`, with the
same header and outcome names. Give each assertion `label: outcome <name>`.

```ts
/**
 * roles-and-access: An owner invites a member, and the member cannot do what their role refuses.
 * State: retained
 * Contract: docs/contributing/journeys/core.md
 * Actor and platform: the new account, and a second new account that it invites, web
 * Entry: the first screen, then the button that opens the team
 * Prerequisites: the dev servers, and the vendors in test mode
 * Isolation and cleanup: each run makes a new account with a unique address. <how the project deletes it>
 * Core: roles-and-access
 *
 * | User action | Expected observation | Proof |
 * | --- | --- | --- |
 * | Sign up, open the team and invite an address | The invitation shows as sent | `outcome('member-invited')` |
 * | Open the invitation in the test inbox, and sign up from it | The member is on the team | `outcome('member-joined')` |
 * | As the member, try an action that their role refuses | The refusal shows, and nothing changes | `outcome('role-refused')` |
 *
 * Failure condition: an action that the role does not allow is refused (`role-refused`).
 * Driver: `mise exec -- bun run journey roles-and-access`
 * Evidence: the Playwright list output, and a trace and the axe report in `test-results/journeys/` on failure
 * Limits: <what this journey does not prove>
 */
import { test } from '@playwright/test';
import { accessible } from '@repo/journeys/testing/a11y';
import { outcomes } from '@repo/journeys/testing/outcome';

test('an owner invites a member, and the member cannot do what their role refuses', async ({ page }) => {
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
  await outcome('member-invited', { text: 'Invitation sent' });
  // Open the invitation in a second browser context, as the invited user.
  await outcome('member-joined', { text: '<the team name>' });
  await outcome('role-refused', { text: 'You do not have access' });
});
```
