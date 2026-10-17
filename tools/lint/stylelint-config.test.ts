import { expect, test } from 'bun:test';
import path from 'node:path';

import stylelint from 'stylelint';

const configFile = path.resolve(import.meta.dir, '../../stylelint.config.ts');

async function rulesFor(code: string): Promise<Array<string>> {
  const { results } = await stylelint.lint({ code, configFile });
  return results.flatMap((result) => result.warnings.map((warning) => warning.rule));
}

test('motion lint accepts compositor transitions, short paint changes and speed tokens', async () => {
  expect(
    await rulesFor(`
      :root { --speed-instant: 0s; --speed-quick: 0.1s; --speed-fade-out: 150ms; --speed-slow: .35s; }
      .row:hover { background-color: red; transition: background-color var(--speed-quick); }
      .arrow { transition: transform var(--speed-fade-out), opacity var(--speed-quick) ease-out; }
      .dialog { animation: fade-in var(--speed-slow) cubic-bezier(0.2, 0, 0, 1); }
      @keyframes fade-in { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; } }
    `),
  ).toEqual([]);
});

test('motion lint rejects layout animation, transition all, literal durations and slow tokens', async () => {
  expect(await rulesFor('.row { transition: margin-left var(--speed-quick); }')).toEqual([
    'plugin/no-low-performance-animation-properties',
  ]);
  expect(await rulesFor('@keyframes slide { to { width: 10px; } }')).toEqual([
    'plugin/no-low-performance-animation-properties',
  ]);
  expect(await rulesFor('.row { transition: all var(--speed-quick); }')).toEqual([
    'plugin/no-low-performance-animation-properties',
  ]);
  expect(await rulesFor('.row { transition-property: all; }')).toEqual([
    'plugin/no-low-performance-animation-properties',
  ]);
  expect(await rulesFor('.row { transition: opacity 150ms; }')).toEqual([
    'declaration-property-value-disallowed-list',
  ]);
  expect(await rulesFor('.row { animation-duration: .2s; }')).toEqual([
    'declaration-property-value-disallowed-list',
  ]);
  expect(await rulesFor(':root { --speed-slow: 0.4s; --speed-drag: 400ms; }')).toEqual([
    'declaration-property-value-allowed-list',
    'declaration-property-value-allowed-list',
  ]);
});
