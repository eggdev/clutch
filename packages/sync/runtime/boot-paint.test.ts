import { afterEach, expect, test } from 'bun:test';

import { afterFirstPaint } from '@repo/sync/runtime/boot';

const names = ['document', 'requestAnimationFrame'] as const;
const saved = names.map((name) => [name, Reflect.get(globalThis, name)] as const);

/** A page with this visibility. Call the result to paint a frame. Without a call, it never paints. */
function page(visibilityState: 'visible' | 'hidden'): () => void {
  const frames: Array<() => void> = [];
  Reflect.set(globalThis, 'document', { visibilityState });
  Reflect.set(globalThis, 'requestAnimationFrame', (onFrame: () => void) => {
    frames.push(onFrame);
    return 0;
  });
  return () => {
    for (const onFrame of frames.splice(0)) {
      onFrame();
    }
  };
}

afterEach(() => {
  for (const [name, value] of saved) {
    Reflect.set(globalThis, name, value);
  }
});

test('a page that paints starts once, in the task after the paint', async () => {
  const paint = page('visible');
  let starts = 0;
  afterFirstPaint(() => {
    starts += 1;
  });
  expect(starts).toBe(0);
  paint();
  expect(starts).toBe(0);
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  expect(starts).toBe(1);
  await Bun.sleep(600);
  expect(starts).toBe(1);
});

test('a background tab that never paints still starts, so it gets live deltas', async () => {
  page('visible');
  let starts = 0;
  afterFirstPaint(() => {
    starts += 1;
  });
  await Bun.sleep(600);
  expect(starts).toBe(1);
});

test('a page that loads hidden starts at once', () => {
  page('hidden');
  let starts = 0;
  afterFirstPaint(() => {
    starts += 1;
  });
  expect(starts).toBe(1);
});
