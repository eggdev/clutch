import { expect, test } from 'bun:test';

import { endSessionOnDevice } from '@/lib/boot';

/**
 * The end of a session from the composition root. `packages/sync/runtime/boot-session.test.ts`
 * tests `endSession`, which it calls: the stop of the engine and the saves, then the clear.
 */
test('a sign-out before the app has started has nothing to end, and does not throw', async () => {
  await expect(endSessionOnDevice()).resolves.toBeUndefined();
});
