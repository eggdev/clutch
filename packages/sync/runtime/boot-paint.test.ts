import { afterEach, expect, test } from 'bun:test';

import { afterFirstPaint } from '@repo/sync/runtime/boot';

const names = ['document', 'requestAnimationFrame', 'setTimeout'] as const;
const saved = names.map((name) => [name, Reflect.get(globalThis, name)] as const);

/**
 * A page with this visibility. `paint` paints a frame, and without a call it
 * never paints. Timers do not run by themselves: `fire(delay)` runs each timer
 * set with that delay, so a test needs no real wait.
 */
function page(visibilityState: 'visible' | 'hidden') {
  const frames: Array<() => void> = [];
  const timers: Array<{ delay: number; run: () => void }> = [];
  Reflect.set(globalThis, 'document', { visibilityState });
  Reflect.set(globalThis, 'requestAnimationFrame', (onFrame: () => void) => {
    frames.push(onFrame);
    return 0;
  });
  Reflect.set(globalThis, 'setTimeout', (run: () => void, delay = 0) => {
    timers.push({ delay, run });
    return 0;
  });
  return {
    paint() {
      for (const onFrame of frames.splice(0)) {
        onFrame();
      }
    },
    fire(delay: number) {
      const due = timers.filter((timer) => timer.delay === delay);
      timers.splice(0, timers.length, ...timers.filter((timer) => timer.delay !== delay));
      for (const timer of due) {
        timer.run();
      }
    },
  };
}

afterEach(() => {
  for (const [name, value] of saved) {
    Reflect.set(globalThis, name, value);
  }
});

test('a page that paints starts once, in the task after the paint', () => {
  const { paint, fire } = page('visible');
  let starts = 0;
  afterFirstPaint(() => {
    starts += 1;
  });
  expect(starts).toBe(0);
  paint();
  expect(starts).toBe(0);
  // The task after the paint.
  fire(0);
  expect(starts).toBe(1);
  // The paint fallback still fires later, and must not start a second time.
  fire(500);
  expect(starts).toBe(1);
});

test('a background tab that never paints still starts, so it gets live deltas', () => {
  const { fire } = page('visible');
  let starts = 0;
  afterFirstPaint(() => {
    starts += 1;
  });
  fire(0);
  expect(starts).toBe(0);
  fire(500);
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
