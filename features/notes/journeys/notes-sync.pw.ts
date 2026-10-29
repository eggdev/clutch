/**
 * notes-sync: A note that one device adds or renames shows on another device without a reload, also after the first device was offline.
 * State: retained
 * Contract: docs/contributing/architecture/local-first-sync.md
 * Actor and platform: the dev actor, web, two browser contexts as two devices
 * Entry: the home page, then the Open notes button, which opens the notes gate
 * Prerequisites: the dev servers, from `mise exec -- bun run dev`
 * Isolation and cleanup: each run adds one note with a unique title to the general space of the dev database. Delete `.data/` to reset it.
 * Budget: 60 s
 *
 * | User action | Expected observation | Proof |
 * | --- | --- | --- |
 * | Open notes on two devices | Each shows the General space | heading assertion |
 * | Add a note on the first device | The second device shows it, with no reload | value assertion |
 * | Rename the note on the first device | The second device shows the new title | value assertion |
 * | Rename it again while the first device is offline | The first device shows it at once, the second does not | value assertions |
 * | Bring the first device back online | The queued rename reaches the second device | value assertion |
 *
 * Failure condition: a rename that the server never confirms stays only on the first device.
 * Driver: `mise exec -- bun run journey notes-sync`
 * Evidence: the Playwright list output, and a trace in `test-results/journeys/` on failure
 * Limits: one actor and one space. It does not prove sign-out, access rules or a server restore.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** The title field of the note that has this saved title. */
function note(page: Page, title: string) {
  return page.getByRole('textbox', { name: 'Note title' }).and(page.locator(`[value="${title}"]`));
}

async function openNotes(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open notes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'General' })).toBeVisible();
}

async function rename(page: Page, from: string, to: string) {
  const field = note(page, from);
  await field.fill(to);
  await field.press('Enter');
}

test('a note syncs to another device, also after an offline rename', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const writer = await first.newPage();
  const reader = await second.newPage();
  await openNotes(writer);
  await openNotes(reader);

  const run = Date.now().toString(36);
  const title = `Journey ${run}`;
  await writer.getByLabel('New note').fill(title);
  await writer.getByRole('button', { name: 'Add' }).click();
  await expect(note(writer, title)).toBeVisible();
  await expect(note(reader, title)).toBeVisible();

  const renamed = `Journey ${run} renamed`;
  await rename(writer, title, renamed);
  await expect(note(writer, renamed)).toBeVisible();
  await expect(note(reader, renamed)).toBeVisible();

  const offline = `Journey ${run} offline`;
  await first.setOffline(true);
  await rename(writer, renamed, offline);
  await expect(note(writer, offline)).toBeVisible();
  await expect(note(reader, renamed)).toBeVisible();

  await first.setOffline(false);
  await expect(note(reader, offline)).toBeVisible({ timeout: 20_000 });
  await expect(note(reader, renamed)).toHaveCount(0);

  await first.close();
  await second.close();
});
