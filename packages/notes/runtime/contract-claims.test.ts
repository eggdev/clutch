import { expect, test } from 'bun:test';

import { notesClient } from '@repo/notes/runtime/client';
import { proveClaims } from '@repo/sync/testing/claims';

test('each command of the notes contract keeps the claims that the contract makes', () => {
  // Each command has at least two checks: a valid input is taken, and each limit refuses.
  const report = proveClaims(notesClient);
  expect(report.checked.length).toBeGreaterThanOrEqual(notesClient.contract.commands.length * 2);
});
