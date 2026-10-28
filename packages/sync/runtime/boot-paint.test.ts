import { afterEach, expect, test } from 'bun:test';

import { afterFirstPaint } from '@repo/sync/runtime/boot';

const names = ['document', 'requestAnimationFrame'] as const;
const saved = names.map((name) => [name, Reflect.get(globalThis, name)] as const);

/** A page with this visibility. `frames` decides if a frame callback ever runs. */
function page(visibilityState: 'visible' | 'hidden', frames: 'paint' | 'no paint') {
  Reflect.set(globalThis, 'document', { visibilityState });
  Reflect.set(globalThis, 'requestAnimationFrame', (onFrame: () => void) => {
    if (frames === 'paint') {
      setTimeout(onFrame, 16);
    }
    return 0;
  });
}

afterEach(() => {
  for (const [name, value] of saved) {
    Reflect.set(globalThis, name, value);
  }
});

test('a page that paints starts once, in the task after the paint', async () => {
  page('visible', 'paint');
  let starts = 0;
  afterFirstPaint(() => {
    starts += 1;
  });
  expect(starts).toBe(0);
  await Bun.sleep(40);
  expect(starts).toBe(1);
  await Bun.sleep(600);
  expect(starts).toBe(1);
});

test('a background tab that never paints still starts, so it gets live deltas', async () => {
  page('visible', 'no paint');
  let starts = 0;
  afterFirstPaint(() => {
    starts += 1;
  });
  await Bun.sleep(600);
  expect(starts).toBe(1);
});

test('a page that loads hidden starts at once', () => {
  page('hidden', 'no paint');
  let starts = 0;
  afterFirstPaint(() => {
    starts += 1;
  });
  expect(starts).toBe(1);
});
