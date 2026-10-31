import { Database } from 'bun:sqlite';
import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SessionQueue } from '@repo/runtime/service/session-queue';
import type { Lease, QueueErrorCode } from '@repo/runtime/types/contracts';
import { QueueError } from '@repo/runtime/types/contracts';

function store() {
  const root = mkdtempSync(path.join(tmpdir(), 'project-review-queue-'));
  return {
    path: path.join(root, 'queue.sqlite'),
    [Symbol.dispose]() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function review(requestId: string, owner = 'agent-a') {
  return { owner, requestId, project: 'pilot', workspace: '/disposable/pilot', revision: 'abc123' };
}

// The expiry tests move the clock with setSystemTime. Each test starts on the real clock.
afterEach(() => {
  setSystemTime();
});

/** Moves the clock `ms` ahead, so a lease expires without a real wait. */
const later = (ms: number) => setSystemTime(new Date(Date.now() + ms));

function grant(queue: SessionQueue, leaseMs = 60_000): Lease {
  const lease = queue.claim({ leaseMs, maxRunMs: 120_000 });
  if (!lease) {
    throw new Error('Expected a granted session.');
  }
  return lease;
}

function expectErrorCode(action: () => unknown, expected: QueueErrorCode) {
  try {
    action();
    throw new Error('Expected queue operation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(QueueError);
    expect((error as QueueError).code).toBe(expected);
  }
}

test('requests survive reopening; identical delivery deduplicates and changed identity conflicts', () => {
  using files = store();
  let id: string;
  {
    using queue = new SessionQueue(files.path);
    ({ id } = queue.enqueue(review('source-1')));
    expect(queue.enqueue(review('source-1')).id).toBe(id);
    expectErrorCode(
      () => queue.enqueue({ ...review('source-1'), revision: 'changed' }),
      'request_conflict',
    );
    expect(queue.enqueue(review('source-1', 'agent-b')).id).not.toBe(id);
  }
  using reopened = new SessionQueue(files.path);
  expect(reopened.get(id).state).toBe('queued');
  expect(grant(reopened).sessionId).toBe(id);
  const publicState = reopened.get(id);
  expect(publicState).not.toHaveProperty('leaseToken');
  expect(publicState).not.toHaveProperty('cleanupToken');
});

test('FIFO spans connections and successful cleanup is required before the next grant', () => {
  using files = store();
  using first = new SessionQueue(files.path);
  using second = new SessionQueue(files.path);
  const a = first.enqueue(review('first'));
  const b = second.enqueue(review('second', 'agent-b'));
  const lease = grant(second);
  expect(lease.sessionId).toBe(a.id);
  expect(first.claim({ leaseMs: 60_000, maxRunMs: 120_000 })).toBeNull();
  expect(first.authorize(lease).state).toBe('active');
  const ticket = second.finish(lease, 'passed');
  expectErrorCode(() => first.authorize(lease), 'stale_lease');
  expect(first.get(a.id).outcome).toBe('passed');
  expect(first.claim({ leaseMs: 60_000, maxRunMs: 120_000 })).toBeNull();
  const result = first.completeCleanup(ticket, {
    verified: true,
    detail: 'Owned fixture resources released.',
  });
  expect(result.state).toBe('finished');
  expect(result.finished).toBeNumber();
  const next = grant(second);
  expect(next.sessionId).toBe(b.id);
  expect(next.generation).toBeGreaterThan(lease.generation);
  expectErrorCode(() => first.renew(lease, 100), 'stale_lease');
  expectErrorCode(() => first.interrupt(lease), 'stale_lease');
  expect(second.authorize(next).id).toBe(b.id);
});

test('independent processes racing for the slot get exactly one grant', async () => {
  using files = store();
  using queue = new SessionQueue(files.path);
  queue.enqueue(review('race-1'));
  queue.enqueue(review('race-2'));
  const entry = path.resolve(import.meta.dir, 'session-queue.ts');
  const source = `import { SessionQueue } from ${JSON.stringify(entry)};
    using queue = new SessionQueue(process.argv[1]);
    console.log(JSON.stringify(queue.claim({leaseMs:60000,maxRunMs:120000})));`;
  const children = Array.from({ length: 4 }, () =>
    Bun.spawn([process.execPath, '-e', source, files.path], { stdout: 'pipe', stderr: 'pipe' }),
  );
  const results = await Promise.all(
    children.map(async (child) => {
      const output = await new Response(child.stdout).text();
      const diagnostics = await new Response(child.stderr).text();
      expect(await child.exited).toBe(0);
      expect(diagnostics).toBe('');
      return JSON.parse(output) as Lease | null;
    }),
  );
  const granted = results.filter((result) => result !== null);
  expect(granted).toHaveLength(1);
  expect(queue.current()?.id).toBe(granted[0]?.sessionId);
});

test('a writer exiting without disposal leaves its acknowledged lease durable', async () => {
  using files = store();
  const entry = path.resolve(import.meta.dir, 'session-queue.ts');
  const source = `import { SessionQueue } from ${JSON.stringify(entry)};
    const queue = new SessionQueue(process.argv[1]);
    queue.enqueue(${JSON.stringify(review('crashed-writer'))});
    const lease = queue.claim({leaseMs:60000,maxRunMs:120000});
    console.log(JSON.stringify(lease));
    process.exit(17);`;
  const child = Bun.spawn([process.execPath, '-e', source, files.path], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(17);
  expect(await new Response(child.stderr).text()).toBe('');
  const lease = JSON.parse(output) as Lease;
  using reopened = new SessionQueue(files.path);
  expect(reopened.authorize(lease).requestId).toBe('crashed-writer');
  const ticket = reopened.interrupt(lease);
  expect(reopened.claim({ leaseMs: 60_000, maxRunMs: 120_000 })).toBeNull();
  reopened.completeCleanup(ticket, { verified: true, detail: 'Crash recovery cleanup verified.' });
  expect(reopened.current()).toBeNull();
});

test('failed cleanup persists quarantine and a stale receipt cannot release a retry', () => {
  using files = store();
  let oldTicket;
  let id: string;
  {
    using queue = new SessionQueue(files.path);
    ({ id } = queue.enqueue(review('failed')));
    queue.enqueue(review('waiting'));
    const lease = grant(queue);
    oldTicket = queue.finish(lease, 'failed');
    const result = queue.completeCleanup(oldTicket, {
      verified: false,
      detail: 'Process termination unconfirmed.',
    });
    expect(result.state).toBe('quarantined');
    expect(result.outcome).toBe('failed');
    expect(result.finished).toBeNull();
    expectErrorCode(
      () => queue.completeCleanup(oldTicket, { verified: true, detail: 'Late response.' }),
      'invalid_state',
    );
  }
  using queue = new SessionQueue(files.path);
  expect(queue.current()?.id).toBe(id);
  expect(queue.claim({ leaseMs: 60_000, maxRunMs: 120_000 })).toBeNull();
  const ticket = queue.retryCleanup(oldTicket);
  expect(ticket.token).not.toBe(oldTicket.token);
  expectErrorCode(
    () => queue.completeCleanup(oldTicket, { verified: true, detail: 'Stale response.' }),
    'stale_cleanup',
  );
  queue.completeCleanup(ticket, { verified: true, detail: 'Termination and release verified.' });
  const next = grant(queue);
  expectErrorCode(
    () => queue.completeCleanup(ticket, { verified: true, detail: 'Duplicate response.' }),
    'stale_cleanup',
  );
  expect(queue.authorize(next).requestId).toBe('waiting');
});

test('cancellation checks ownership, skips queued work, and fences active interaction', () => {
  using files = store();
  using queue = new SessionQueue(files.path);
  const waiting = queue.enqueue(review('cancel-before-start'));
  const active = queue.enqueue(review('cancel-after-start'));
  expectErrorCode(() => queue.cancel(waiting.id, 'other-owner'), 'forbidden');
  expect(queue.cancel(waiting.id, 'agent-a')).toBeNull();
  expect(queue.get(waiting.id).state).toBe('cancelled');
  const lease = grant(queue);
  expect(lease.sessionId).toBe(active.id);
  const ticket = queue.cancel(active.id, 'agent-a');
  expect(ticket).not.toBeNull();
  expect(queue.cancel(active.id, 'agent-a')).toEqual(ticket);
  expect(queue.get(active.id).outcome).toBe('cancelled');
  expectErrorCode(() => queue.authorize(lease), 'stale_lease');
});

test('expired leases cannot act or renew, and claiming does not bypass expired cleanup', () => {
  using files = store();
  using queue = new SessionQueue(files.path);
  const first = queue.enqueue(review('expires'));
  queue.enqueue(review('next'));
  const lease = grant(queue, 1000);
  later(2000);
  expectErrorCode(() => queue.authorize(lease), 'stale_lease');
  expectErrorCode(() => queue.renew(lease, 60_000), 'stale_lease');
  expect(queue.claim({ leaseMs: 60_000, maxRunMs: 120_000 })).toBeNull();
  expect(queue.get(first.id).outcome).toBe('expired');
  const ticket = queue.pendingCleanup();
  if (!ticket) {
    throw new Error('Expired session must require cleanup.');
  }
  queue.completeCleanup(ticket, { verified: true, detail: 'Expired session resources released.' });
  expect(queue.authorize(grant(queue)).requestId).toBe('next');
});

test('renewal is bounded by maximum runtime and forged identities are rejected', () => {
  using files = store();
  using queue = new SessionQueue(files.path);
  queue.enqueue(review('renew'));
  const lease = grant(queue);
  const before = queue.get(lease.sessionId);
  const renewed = queue.renew(lease, 300_000);
  expect(renewed.deadline).toBe(before.maxDeadline);
  expectErrorCode(() => queue.authorize({ ...lease, token: 'wrong' }), 'stale_lease');
  expectErrorCode(
    () => queue.authorize({ ...lease, generation: lease.generation + 1 }),
    'stale_lease',
  );
  expect(queue.authorize(lease).state).toBe('active');
});

test('reopening does not interrupt another controller; explicit recovery fences the known generation', () => {
  using files = store();
  let lease: Lease;
  {
    using queue = new SessionQueue(files.path);
    queue.enqueue(review('interrupted'));
    queue.enqueue(review('preserved'));
    lease = grant(queue);
  }
  using queue = new SessionQueue(files.path);
  expect(queue.authorize(lease).state).toBe('active');
  const ticket = queue.interrupt(lease);
  expectErrorCode(() => queue.authorize(lease), 'stale_lease');
  expect(queue.get(lease.sessionId).outcome).toBe('interrupted');
  expect(queue.claim({ leaseMs: 60_000, maxRunMs: 120_000 })).toBeNull();
  queue.completeCleanup(ticket, {
    verified: true,
    detail: 'Recovery cleanup verified without UI replay.',
  });
  expect(queue.authorize(grant(queue)).requestId).toBe('preserved');
});

test('owner disappearance expires into durable cleanup that survives reopening', () => {
  using files = store();
  {
    using queue = new SessionQueue(files.path);
    queue.enqueue(review('owner-lost'));
    grant(queue, 1000);
    later(2000);
    expect(queue.expire()).not.toBeNull();
  }
  using queue = new SessionQueue(files.path);
  const ticket = queue.pendingCleanup();
  if (!ticket) {
    throw new Error('Recovery must retain cleanup identity.');
  }
  expect(queue.get(ticket.sessionId).outcome).toBe('expired');
  queue.completeCleanup(ticket, { verified: true, detail: 'Owner-loss cleanup complete.' });
  expect(queue.current()).toBeNull();
});

test('invalid policy and incompatible persisted schema fail closed', () => {
  using files = store();
  {
    using queue = new SessionQueue(files.path);
    expectErrorCode(() => queue.claim({ leaseMs: 0, maxRunMs: 10 }), 'invalid_request');
    expectErrorCode(() => queue.claim({ leaseMs: 20, maxRunMs: 10 }), 'invalid_request');
    expectErrorCode(() => queue.enqueue({ ...review('invalid'), owner: '' }), 'invalid_request');
  }
  const database = new Database(files.path);
  database.exec('PRAGMA user_version=2');
  database.close();
  expectErrorCode(() => new SessionQueue(files.path), 'unsupported_schema');
});
