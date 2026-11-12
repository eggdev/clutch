import type { Page } from '@playwright/test';

/**
 * Layout problems that a person sees on a page. A journey reads them with
 * `screenProblems`, and runs them again at the largest text size with
 * `atLargestText`. The checks report each problem as a sentence, and they never
 * fail a journey by themselves. See
 * https://github.com/eggdev/clutch/blob/main/docs/contributing/end-to-end-testing.md#screen-findings.
 */

/**
 * Each layout problem of the page as it is, one sentence each: the document
 * scrolls sideways, an element with text is wider than its box and clips the
 * text, or a visible element with text goes past the right edge of the window.
 * Each sentence names the element by its tag and its first 40 characters.
 */
export function screenProblems(page: Page): Promise<Array<string>> {
  return page.evaluate(() => {
    const problems: Array<string> = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      problems.push(
        `The page scrolls sideways: its width is ${root.scrollWidth} px and the window is ${root.clientWidth} px.`,
      );
    }
    for (const element of document.body.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const shown =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        box.width > 0 &&
        box.height > 0;
      const holdsText = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
      );
      if (!holdsText || !shown) {
        continue;
      }
      const text = (element.textContent ?? '').replaceAll(/\s+/gu, ' ').trim();
      const label = `<${element.tagName.toLowerCase()}> "${text.slice(0, 40)}"`;
      const clips = style.overflowX === 'hidden' || style.overflowX === 'clip';
      if (
        clips &&
        element.clientWidth > 0 &&
        element.scrollWidth > element.clientWidth + 1 &&
        style.textOverflow !== 'ellipsis'
      ) {
        problems.push(`${label} is wider than its box, and it clips its text.`);
      }
      if (box.right > window.innerWidth) {
        problems.push(`${label} extends past the right edge of the window.`);
      }
    }
    return problems;
  });
}

/**
 * Runs `run` with the root font size at 200%, which is what a person with the
 * largest text setting sees, since the app sizes its text in `rem`. The old
 * size comes back when `run` throws too.
 */
export async function atLargestText<T>(page: Page, run: () => Promise<T>): Promise<T> {
  const previous = await page.evaluate(() => document.documentElement.style.fontSize);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  try {
    return await run();
  } finally {
    await page.evaluate((size: string) => {
      document.documentElement.style.fontSize = size;
    }, previous);
  }
}
