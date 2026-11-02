import { expect, test } from 'bun:test';

import { graceFor } from '@/sync/grace';

const now = new Date('2026-11-20T12:00:00Z');
const released = (date: string) => ({ tag: 'v0.35.0', date: new Date(date) });

/** The grace of a project at v0.34.0, behind v0.36.0, with a 7-day window. */
const sevenDays = (date: string) =>
  graceFor({ from: 'v0.34.0', to: 'v0.36.0', firstMissing: released(date), days: 7, now });

test('behind a release of the same major version, within the window, only warns', () => {
  const grace = graceFor({
    from: 'v0.34.0',
    to: 'v0.36.0',
    firstMissing: released('2026-11-18T09:00:00Z'),
    days: 14,
    now,
  });
  expect(grace.within).toBe(true);
  expect(grace.message).toContain('v0.35.0 came out 2 days ago, so this passes for 12 more days');
});

test('the last day of the window still passes, and the next day fails', () => {
  expect(sevenDays('2026-11-13T12:00:00Z').within).toBe(true);
  const late = sevenDays('2026-11-12T12:00:00Z');
  expect(late.within).toBe(false);
  expect(late.message).toContain('came out 8 days ago, past the 7-day grace window');
});

test('a new major version, or an unknown release date, fails at once', () => {
  const recent = released('2026-11-20T09:00:00Z');
  expect(
    graceFor({ from: 'v0.36.0', to: 'v1.0.0', firstMissing: recent, days: 14, now }).within,
  ).toBe(false);
  expect(
    graceFor({ from: 'v0.34.0', to: 'v0.36.0', firstMissing: null, days: 14, now }),
  ).toMatchObject({
    within: false,
    message: expect.stringContaining('date of the next release is unknown'),
  });
});
