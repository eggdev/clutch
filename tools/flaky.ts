import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The flaky-test quarantine registry, `tools/flaky-tests.json`. The blocking
 * test runs leave each entry out, and `tools/run-quarantined.ts` runs them on
 * their own. See docs/contributing/testing.md#flaky-tests.
 */
export const registryFile = 'tools/flaky-tests.json';

export type FlakyTest = {
  readonly file: string;
  readonly name: string;
  readonly issue: string;
  readonly until: string;
  readonly reason: string;
};

/** The entries of the registry at `root`. A repository without the file has none. */
export function quarantined(root: string): Array<FlakyTest> {
  let text: string;
  try {
    text = readFileSync(path.join(root, registryFile), 'utf-8');
  } catch {
    return [];
  }
  const data = JSON.parse(text) as { tests?: Array<FlakyTest> };
  return Array.isArray(data.tests) ? data.tests : [];
}

/** A journey screenshot, quarantined by its `snap` name. `snap` reads these itself. */
const isSnap = (test: FlakyTest) => test.file.endsWith('.pw.ts');

/** The quarantined `bun test` tests, which the test runs leave out. */
export const bunTests = (tests: ReadonlyArray<FlakyTest>) => tests.filter((test) => !isSnap(test));

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/**
 * A `bun test -t` pattern that matches every test except the quarantined ones.
 * Bun matches the full name, with any describe names first, so the pattern
 * allows a prefix before each quarantined name.
 */
export function excludePattern(tests: ReadonlyArray<FlakyTest>): string | null {
  if (tests.length === 0) {
    return null;
  }
  return `^(?!(?:.* )?(?:${tests.map((test) => escape(test.name)).join('|')})$)`;
}

/** The `bun test -t` pattern that matches one quarantined test. */
export const onlyPattern = (test: FlakyTest) => `^(?:.* )?${escape(test.name)}$`;
