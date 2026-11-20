import { expect, test } from 'bun:test';

import { memoryLocalDatabase } from '@repo/sync/testing/local-database';
import { localDatabaseCases } from '@repo/sync/testing/local-database-conformance';

// Each case gets its own fake. The first `open` of a case gives its first
// handle, and each later one gives another handle on the same rows, as another
// tab or a later start opens.
for (const item of localDatabaseCases) {
  test(`the memory fake: ${item.name}`, async () => {
    const fake = memoryLocalDatabase();
    let opened = 0;
    const open = () => {
      opened += 1;
      return Promise.resolve(opened === 1 ? fake : fake.tab(Promise.resolve()));
    };
    expect(await item.run(open)).toBeUndefined();
  });
}
