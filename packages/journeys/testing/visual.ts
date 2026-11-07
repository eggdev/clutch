import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { flush, measureOf } from '@repo/journeys/testing/measure';

/**
 * The screenshot check of web journeys. A journey calls `snap(page, 'name')` at
 * a stable point. It captures the page on the device of the run, in each
 * scheme. Each device keeps its own baseline: the Phone project is `mobile`,
 * the Tablet project is `tablet` and the Desktop project is `desktop`. In CI it compares each shot
 * with its committed baseline,
 * `<journey folder>/__screenshots__/<name>-<width>-<scheme>.png`, fails on a
 * change, and writes each changed or new shot to `test-results/visual/` at its
 * baseline path. A local run writes every shot there. CI is the only renderer: fonts and anti-aliasing differ between
 * machines, so a local run captures and never compares. See
 * https://github.com/eggdev/clutch/blob/main/docs/contributing/setup/verification.md#screenshots.
 */

/** The width names of the devices, which `metadata.width` of each project in the Playwright config sets. */
const widths = ['mobile', 'tablet', 'desktop'] as const;

const schemes = ['light', 'dark'] as const;

type Width = (typeof widths)[number];
type Scheme = (typeof schemes)[number];

/** Where `test-results/visual/` mirrors the baselines. `visual pull` copies from here. */
const shotsFolder = 'test-results/visual';

/** The share of pixels that may differ, for anti-aliasing noise. */
const maxDiffPixelRatio = 0.001;

const fix =
  'If the change is intended, run `mise exec -- bun run visual pull <pr>` to take the CI shots as the baselines, and give the reason in the PR body.';

/** The baseline file name of one shot. */
export const shotName = (name: string, width: Width, scheme: Scheme) =>
  `${name}-${width}-${scheme}.png`;

/**
 * Whether this run compares with the baselines: on GitHub Actions, or when
 * `VISUAL_COMPARE=1`. Not on `CI`, which `validate` sets on a laptop too.
 */
export function comparing(env: Record<string, string | undefined> = process.env) {
  return env.VISUAL_COMPARE === '1' || env.GITHUB_ACTIONS === 'true';
}

/**
 * The snap names that `tools/flaky-tests.json` quarantines for the journey
 * file `file`. `tools/flaky.ts` owns the registry, but a package may not import
 * `tools/`, so this reads the same file and the same `file` and `name` fields. A quarantined shot is still compared and kept, but a change
 * warns instead of failing. See docs/contributing/testing.md#flaky-tests.
 */
function quarantinedSnaps(file: string, root = process.cwd()): Set<string> {
  let text: string;
  try {
    text = readFileSync(path.join(root, 'tools/flaky-tests.json'), 'utf-8');
  } catch {
    return new Set();
  }
  const tests: Array<{ file?: string; name?: string }> = JSON.parse(text).tests ?? [];
  return new Set(tests.filter((entry) => entry.file === file).map((entry) => entry.name ?? ''));
}

type SnapOptions = {
  /** Regions whose content changes on each run, such as a generated title. */
  readonly mask?: ReadonlyArray<Locator>;
  /** The whole page, not only the viewport. */
  readonly fullPage?: boolean;
  /**
   * CSS that applies only while the shot is taken. Use it to hide a region
   * whose size changes on each run, such as a list that grows with the data
   * of earlier runs. `mask` keeps the size of a region, so it cannot cover that.
   */
  readonly style?: string;
};

/** Takes shots until two in a row match, as `toHaveScreenshot` does, at most 5. */
async function stableShot(page: Page, options: SnapOptions) {
  const take = () =>
    page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      fullPage: options.fullPage ?? false,
      mask: [...(options.mask ?? [])],
      ...(options.style === undefined ? {} : { style: options.style }),
    });
  let previous = await take();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = await take();
    if (next.equals(previous)) {
      return next;
    }
    previous = next;
  }
  return previous;
}

/** Sets the scheme the way the boot script does: the `dark` class on `<html>`. */
async function setScheme(page: Page, scheme: Scheme) {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  // A string runs in the page, which has the DOM that this file's types lack.
  await page.evaluate(
    `document.documentElement.classList.toggle('dark', ${scheme === 'dark'});
     document.documentElement.style.colorScheme = '${scheme}';`,
  );
}

/** The width name of the run's device, from the project's `metadata.width`. */
function widthOf(info: ReturnType<typeof test.info>): Width {
  const width: unknown = info.project.metadata?.width;
  const found = widths.find((item) => item === width);
  if (!found) {
    throw new Error(
      `The Playwright project ${info.project.name} sets no metadata.width of mobile, tablet or desktop, so snap cannot name its baseline. Run journeys with \`mise exec -- bun run journey\`.`,
    );
  }
  return found;
}

async function shoot(page: Page, name: string, options: SnapOptions) {
  const info = test.info();
  const width = widthOf(info);
  const quarantine = quarantinedSnaps(
    path.relative(process.cwd(), info.file).split(path.sep).join('/'),
  );
  const wasDark = await page.evaluate<boolean>(
    "document.documentElement.classList.contains('dark')",
  );
  try {
    for (const scheme of schemes) {
      await setScheme(page, scheme);
      await page.evaluate('document.fonts.ready.then(() => true)');
      const file = shotName(name, width, scheme);
      const shot = await stableShot(page, options);
      const mirror = path.join(shotsFolder, path.relative(process.cwd(), info.snapshotPath(file)));
      // Locally every shot is kept to look at. In CI only a changed or a new
      // one, so the artifact holds exactly what `visual pull` should copy.
      let keep = true;
      // A quarantine covers a flaky diff, not a missing baseline, so a missing one still fails.
      if (comparing() && quarantine.has(name) && existsSync(info.snapshotPath(file))) {
        try {
          expect(shot).toMatchSnapshot(file, { maxDiffPixelRatio });
          keep = false;
        } catch (error) {
          // Only a pixel diff is the flake the quarantine covers. A size change is a
          // layout change, and any other error is real, so both still fail.
          if (
            !/pixels \(ratio [\d.]+ of all image pixels\) are different/u.test(
              error instanceof Error ? error.message : '',
            )
          ) {
            throw error;
          }
          info.annotations.push({
            type: 'warning',
            description: `${file} differs from its baseline, but ${name} is quarantined in tools/flaky-tests.json.`,
          });
        }
      } else if (comparing()) {
        const before = info.errors.length;
        // Soft, so one run reports every changed shot, and `visual pull` gets them all.
        expect
          .soft(shot, `${file} differs from its baseline. ${fix}`)
          .toMatchSnapshot(file, { maxDiffPixelRatio });
        keep = info.errors.length > before;
      }
      if (keep) {
        await mkdir(path.dirname(mirror), { recursive: true });
        await writeFile(mirror, shot);
      }
    }
  } finally {
    await setScheme(page, wasDark ? 'dark' : 'light');
  }
}

/**
 * Captures the page on the run's device in each scheme, then puts the scheme
 * back, so the journey goes on as before. A layout shift during the snap does
 * not count toward the budget, because the snap makes it, not the app.
 */
export async function snap(page: Page, name: string, options: SnapOptions = {}) {
  const measure = measureOf(page);
  await flush(page);
  const shiftsBefore = measure?.shifts.length ?? 0;
  try {
    await shoot(page, name, options);
  } finally {
    // The scheme and the `style` of a shot can move the page. The user never
    // sees that, so the layout shift budget drops each shift from the snap.
    await page.evaluate(
      'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))',
    );
    await flush(page);
    measure?.shifts.splice(shiftsBefore);
  }
}
