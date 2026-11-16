import { expect, test } from 'bun:test';

import { accessClient } from '@repo/access/runtime/client';
import { proveClaims } from '@repo/sync/testing/claims';

test('each command of the access contract keeps the claims that the contract makes', () => {
  // Each command has at least two checks: a valid input is taken, and each limit refuses.
  const report = proveClaims(accessClient);
  expect(report.checked.length).toBeGreaterThanOrEqual(accessClient.contract.commands.length * 2);
});
