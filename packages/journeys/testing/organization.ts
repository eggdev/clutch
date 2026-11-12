import type { BrowserContext } from '@playwright/test';

/**
 * Gives a browser context an organization of its own, through the cookie
 * that the development identity reads. A journey that calls it before its
 * first page starts with no record, and no other run can change what it
 * sees. Pass the ID that another context got to put two devices in one
 * organization. A project with a sign-in vendor makes a new account instead.
 *
 * ```ts
 * const organization = await ownOrganization(page.context(), baseURL);
 * await ownOrganization(await browser.newContext(), baseURL, organization);
 * ```
 */
export async function ownOrganization(
  context: BrowserContext,
  baseURL: string | undefined,
  id = `journey-${crypto.randomUUID()}`,
): Promise<string> {
  if (!baseURL) {
    throw new Error(
      'ownOrganization needs the base URL of the app. Take `baseURL` from the test fixtures.',
    );
  }
  await context.addCookies([{ name: 'dev-organization-id', value: id, url: baseURL }]);
  return id;
}
