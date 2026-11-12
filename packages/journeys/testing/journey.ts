import { expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { accessible } from '@repo/journeys/testing/a11y';
import { ownOrganization } from '@repo/journeys/testing/organization';
import { outcomes } from '@repo/journeys/testing/outcome';
import { records, settled } from '@repo/journeys/testing/pool';
import type { PoolRow } from '@repo/journeys/testing/pool';
import { test } from '@repo/journeys/testing/test';
import { callTool } from '@repo/journeys/testing/tools';
import { snap } from '@repo/journeys/testing/visual';
import type { Device, JourneyData, Step, Target } from '@repo/journeys/types/steps';

/**
 * The Playwright runner of a journey in data form. `journey(title, steps)`
 * registers one test, which runs each step on the browser. The first device
 * is the page of the test, and the second device is a browser context of its
 * own in the same organization, made when a step names it. A journey file
 * imports `journey` from here, and `JOURNEY_COMPILE=1` keeps it from
 * registering the test, so the native compiler can read its steps. See
 * docs/contributing/end-to-end-testing.md#data-journeys.
 */

/** The devices of a run: the page of the test, and what the second device needs. */
type Devices = { first: Page; browser: Browser; baseURL?: string };

/** The locator of a target, on one page. */
function locate(page: Page, target: Target) {
  if (target.kind === 'button') {
    return page.getByRole('button', { name: target.name });
  }
  if (target.kind === 'heading') {
    const name = { name: target.name };
    return page.getByRole(
      'heading',
      target.level === undefined ? name : { ...name, level: target.level },
    );
  }
  if (target.kind === 'field') {
    if (target.value === undefined) {
      return page.getByLabel(target.label);
    }
    // The textbox with the label, and the saved value that tells two fields apart.
    return page
      .getByRole('textbox', { name: target.label })
      .and(page.locator(`[value=${JSON.stringify(target.value)}]`));
  }
  return page.getByText(target.text, { exact: true });
}

/** A field value of a pool record, as text. */
function valueText(row: PoolRow, field: string): string {
  const value = row[field];
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** The most records that one answer of a list tool holds. */
const onePage = 200;

/**
 * The values of one field that the server holds for a group, sorted. The
 * runner asks the list tool of the load function, as an agent does.
 */
async function serverValues(
  page: Page,
  step: Extract<Step, { do: 'server-holds' }>,
): Promise<Array<string>> {
  const answer = await callTool(page, step.tool, { id: step.id, limit: onePage });
  const items: Array<unknown> = Array.isArray(answer.items) ? answer.items : [];
  return items
    .map((item) => {
      const value: unknown =
        typeof item === 'object' && item !== null ? Reflect.get(item, step.field) : undefined;
      return typeof value === 'string' ? value : JSON.stringify(value);
    })
    .toSorted();
}

/** Runs one step on its page. */
async function runStep(step: Step, pageOf: (device: Device) => Promise<Page>): Promise<void> {
  const page = await pageOf(step.on ?? 'first');
  if (step.do === 'open') {
    await page.goto(step.path);
  } else if (step.do === 'tap') {
    await locate(page, step.target).click();
  } else if (step.do === 'fill') {
    await locate(page, step.target).fill(step.text);
  } else if (step.do === 'submit') {
    await locate(page, step.target).press('Enter');
  } else if (step.do === 'see') {
    await expect(locate(page, step.target)).toBeVisible(
      step.within === undefined ? undefined : { timeout: step.within },
    );
  } else if (step.do === 'gone') {
    await expect(locate(page, step.target)).toHaveCount(0);
  } else if (step.do === 'offline') {
    await page.context().setOffline(step.offline);
  } else if (step.do === 'advance') {
    await page.context().clock.fastForward(step.ms);
  } else if (step.do === 'tool') {
    await callTool(page, step.name, step.input);
  } else if (step.do === 'settled') {
    await settled(page);
  } else if (step.do === 'server-holds') {
    // A write of the device reaches the server a moment later, so the runner asks again until it matches.
    await expect.poll(() => serverValues(page, step)).toEqual([...step.values].toSorted());
  } else if (step.do === 'holds') {
    const rows = await records(page, step.model);
    const values = rows.map((row) => valueText(row, step.field));
    expect(values.toSorted()).toEqual([...step.values].toSorted());
  } else if (step.do === 'shot') {
    await snap(page, step.name, step.style === undefined ? {} : { style: step.style });
  } else if (step.do === 'accessible') {
    await accessible(page, step.name);
  } else {
    await outcomes(page)(step.name, step.expected);
  }
}

/**
 * Runs the steps in order. The second device is made only when a step names
 * it, in the organization of the first device, and it is closed at the end.
 */
export async function runSteps(steps: ReadonlyArray<Step>, devices: Devices): Promise<void> {
  const { first, browser, baseURL } = devices;
  // A journey with a clock step owns the clock of each device, from before the
  // first page loads. Time still passes by itself, and `advance` moves it on.
  // Any other journey runs on real time: its network is real, and a clock that
  // jumps would fire the timers of a retry before the answer can come.
  const ownsClock = steps.some((step) => step.do === 'advance');
  if (ownsClock) {
    await first.context().clock.install();
  }
  const organization = await ownOrganization(first.context(), baseURL);
  let second: { close: () => Promise<void>; page: Page } | undefined;
  const pageOf = async (device: Device): Promise<Page> => {
    if (device === 'first') {
      return first;
    }
    if (second === undefined) {
      const context = await browser.newContext();
      if (ownsClock) {
        await context.clock.install();
      }
      await ownOrganization(context, baseURL, organization);
      const page = await context.newPage();
      second = { close: () => context.close(), page };
    }
    return second.page;
  };
  try {
    for (const step of steps) {
      await runStep(step, pageOf);
    }
  } finally {
    await second?.close();
  }
}

/**
 * Declares a journey and returns its data. It registers one Playwright test
 * with the journey test kit, unless `JOURNEY_COMPILE` is `1`.
 */
export function journey(title: string, steps: ReadonlyArray<Step>): JourneyData {
  if (process.env.JOURNEY_COMPILE !== '1') {
    // The test is registered here, so its location is this file. The measures need the journey file, which is the first `.journey.ts` on the stack.
    const stack = new Error('The journey call, for its file.').stack ?? '';
    const file = /(?:file:\/\/)?([^\s()]+\.journey\.ts)/u.exec(stack)?.[1];
    const annotation = file === undefined ? [] : [{ type: 'journey-file', description: file }];
    test(title, { annotation }, async ({ page, browser, baseURL }) => {
      await runSteps(steps, { first: page, browser, baseURL });
    });
  }
  return { title, steps };
}
