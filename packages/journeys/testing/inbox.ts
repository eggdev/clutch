import { spawnSync } from 'node:child_process';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Reads the email that a core journey needs, through the command that
 * `journeys.inbox` in clutch.yaml names. A journey calls:
 *
 * ```ts
 * await enterEmailCode(page, { to: email, into: 'Sign-in code' });
 * await openEmailLink(page, { to: email });
 * ```
 *
 * The runner passes the command in `JOURNEY_INBOX`. See the inbox contract in
 * https://github.com/eggdev/clutch/blob/main/docs/contributing/journeys/core.md.
 */

/** The newest email to one address. A field is absent until the email has it. */
export type InboxMessage = { code?: string; link?: string };

/** How long an email may take to arrive. */
const arrivalMs = 30_000;

/**
 * Runs the inbox command for one address. It prints one JSON object, and `{}`
 * until the email arrives. A command that fails stops the journey at once.
 */
export function readInbox(command: ReadonlyArray<string>, to: string): InboxMessage {
  const [program, ...args] = command;
  if (program === undefined) {
    throw new Error('No inbox command. Set journeys.inbox in clutch.yaml.');
  }
  const run = spawnSync(program, [...args, to], { encoding: 'utf-8' });
  if (run.status !== 0) {
    throw new Error(`The inbox command failed for ${to}: ${run.stderr || run.error?.message}`);
  }
  return JSON.parse(run.stdout) as InboxMessage;
}

async function arrived(to: string, field: keyof InboxMessage) {
  const command = JSON.parse(process.env.JOURNEY_INBOX ?? '[]') as ReadonlyArray<string>;
  let value: string | undefined;
  await expect
    .poll(
      () => {
        value = readInbox(command, to)[field];
        return value !== undefined;
      },
      { message: `an email to ${to} with a ${field}`, timeout: arrivalMs },
    )
    .toBe(true);
  return value ?? '';
}

/** Types the code from the newest email to `to` into the field labelled `into`. */
export async function enterEmailCode(page: Page, where: { to: string; into: string }) {
  await test.step(`enter the code emailed to ${where.to}`, async () => {
    await page.getByLabel(where.into).fill(await arrived(where.to, 'code'));
  });
}

/** Opens the link in the newest email to `to`, as a person who taps it. */
export async function openEmailLink(page: Page, where: { to: string }) {
  await test.step(`open the link emailed to ${where.to}`, async () => {
    await page.goto(await arrived(where.to, 'link'));
  });
}
