import { expect, test } from 'bun:test';

import { mixedColor } from '@repo/app-build/runtime/native-styles.ts';

test('a class with an opacity modifier is named', () => {
  // The class is put together here, so Tailwind does not read it from this file and make it.
  const name = ['.bg-fg', '10'].join(String.raw`\/`);
  const css = `${name} { background-color: color-mix(in oklab, var(--fg) 10%, transparent) }`;
  expect(mixedColor(css)).toContain(name);
});

test('a token that mixes colors is named', () => {
  expect(mixedColor(':root { --ring: color-mix(in srgb, #000 25%, transparent) }')).toContain(
    '--ring',
  );
});

test('plain colors and the reset of Tailwind pass', () => {
  const css = [
    '.bg-surface { background-color: var(--surface) }',
    '::placeholder { color: color-mix(in oklab, currentcolor 50%, transparent) }',
  ].join('\n');
  expect(mixedColor(css)).toBeUndefined();
});
