import { expect, test } from 'bun:test';

import { memoryLocalDatabase } from '@repo/sync/testing/local-database';
import { localDatabaseCases } from '@repo/sync/testing/local-database-conformance';

// Each case gets its own fake, so `open` returns the same stored data within a case.
for (const item of localDatabaseCases) {
  test(`the memory fake: ${item.name}`, async () => {
    const fake = memoryLocalDatabase();
    expect(await item.run(() => Promise.resolve(fake))).toBeUndefined();
  });
}
