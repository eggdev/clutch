import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

import type { CleanupTicket, Enqueue, Lease, Outcome, Session } from '@repo/runtime/src/contracts';
import { QueueError } from '@repo/runtime/src/contracts';
import { initialize } from '@repo/runtime/src/schema';

type Row = Session & { leaseToken: string | null; cleanupToken: string | null };

function duration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || !Number.isSafeInteger(Date.now() + value)) {
    throw new QueueError(
      'invalid_request',
      'Durations must be positive safe integer milliseconds.',
    );
  }
}

function snapshot(row: Row): Session {
  const { leaseToken: _leaseToken, cleanupToken: _cleanupToken, ...session } = row;
  return session;
}

function matchLease(row: Row, lease: Lease): void {
  if (
    row.state !== 'active' ||
    row.generation !== lease.generation ||
    row.leaseToken !== lease.token
  ) {
    throw new QueueError('stale_lease', 'Review lease is no longer current.');
  }
}

function cleanupIdentity(row: Row): CleanupTicket {
  if (row.generation === null || !row.cleanupToken) {
    throw new QueueError('invalid_state', 'Cleanup identity missing.');
  }
  return { sessionId: row.id, generation: row.generation, token: row.cleanupToken };
}

export class SessionQueue implements Disposable {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true, strict: true });
    try {
      initialize(this.db);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  [Symbol.dispose](): void {
    this.db.close();
  }

  enqueue(input: Enqueue): Session {
    for (const value of [
      input.owner,
      input.requestId,
      input.project,
      input.workspace,
      input.revision,
    ]) {
      if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
        throw new QueueError(
          'invalid_request',
          'Queue identity fields must be nonempty bounded strings.',
        );
      }
    }
    return this.db
      .transaction(() => {
        const old = this.db
          .query<Row, [string, string]>('SELECT * FROM sessions WHERE owner=? AND requestId=?')
          .get(input.owner, input.requestId);
        if (old) {
          if (
            old.project !== input.project ||
            old.workspace !== input.workspace ||
            old.revision !== input.revision
          ) {
            throw new QueueError(
              'request_conflict',
              'Request ID already names different review input.',
            );
          }
          return snapshot(old);
        }
        const id = randomUUID();
        this.db
          .query(`INSERT INTO sessions
        (id,owner,requestId,project,workspace,revision,state,created)
        VALUES (?,?,?,?,?,?,'queued',?)`)
          .run(
            id,
            input.owner,
            input.requestId,
            input.project,
            input.workspace,
            input.revision,
            Date.now(),
          );
        return this.get(id);
      })
      .immediate();
  }

  get(id: string): Session {
    return snapshot(this.row(id));
  }

  current(): Session | null {
    const row = this.occupied();
    return row ? snapshot(row) : null;
  }

  claim(policy: { leaseMs: number; maxRunMs: number }): Lease | null {
    duration(policy.leaseMs);
    duration(policy.maxRunMs);
    if (policy.leaseMs > policy.maxRunMs) {
      throw new QueueError('invalid_request', 'Lease cannot exceed the maximum session runtime.');
    }
    return this.db
      .transaction(() => {
        const occupied = this.occupied();
        if (occupied) {
          if (
            occupied.state === 'active' &&
            occupied.deadline !== null &&
            occupied.deadline <= Date.now()
          ) {
            this.clean(occupied, 'expired');
          }
          return null;
        }
        const row = this.db
          .query<Row, []>("SELECT * FROM sessions WHERE state='queued' ORDER BY sequence LIMIT 1")
          .get();
        if (!row) {
          return null;
        }
        const meta = this.db
          .query<{ generation: number }, []>(
            'UPDATE queue_meta SET generation=generation+1 WHERE id=1 RETURNING generation',
          )
          .get();
        if (!meta || !Number.isSafeInteger(meta.generation)) {
          throw new QueueError('invalid_state', 'Queue generation is unavailable or exhausted.');
        }
        const token = randomUUID();
        const now = Date.now();
        this.db
          .query(`UPDATE sessions SET state='active', generation=?, leaseToken=?,
        deadline=?, maxDeadline=? WHERE id=?`)
          .run(meta.generation, token, now + policy.leaseMs, now + policy.maxRunMs, row.id);
        return { sessionId: row.id, generation: meta.generation, token };
      })
      .immediate();
  }

  authorize(lease: Lease): Session {
    return snapshot(this.active(lease));
  }

  renew(lease: Lease, leaseMs: number): Session {
    duration(leaseMs);
    return this.db
      .transaction(() => {
        const row = this.active(lease);
        if (row.maxDeadline === null) {
          throw new QueueError('invalid_state', 'Active session maximum deadline missing.');
        }
        const deadline = Math.min(Date.now() + leaseMs, row.maxDeadline);
        this.db.query('UPDATE sessions SET deadline=? WHERE id=?').run(deadline, row.id);
        return this.get(row.id);
      })
      .immediate();
  }

  finish(lease: Lease, outcome: 'passed' | 'failed'): CleanupTicket {
    if (outcome !== 'passed' && outcome !== 'failed') {
      throw new QueueError('invalid_request', 'Finish outcome must be passed or failed.');
    }
    return this.db.transaction(() => this.clean(this.active(lease), outcome)).immediate();
  }

  cancel(id: string, owner: string): CleanupTicket | null {
    return this.db
      .transaction(() => {
        const row = this.row(id);
        if (row.owner !== owner) {
          throw new QueueError('forbidden', 'Review belongs to a different owner.');
        }
        if (row.state === 'queued') {
          this.db
            .query(
              "UPDATE sessions SET state='cancelled', outcome='cancelled', finished=? WHERE id=?",
            )
            .run(Date.now(), id);
          return null;
        }
        if (row.state === 'active') {
          return this.clean(row, 'cancelled');
        }
        // Retrying cancellation must not replace cleanup already in progress.
        return row.state === 'cleaning' || row.state === 'quarantined'
          ? cleanupIdentity(row)
          : null;
      })
      .immediate();
  }

  expire(): CleanupTicket | null {
    return this.db
      .transaction(() => {
        const row = this.occupied();
        if (!row || row.state !== 'active' || row.deadline === null || row.deadline > Date.now()) {
          return null;
        }
        return this.clean(row, 'expired');
      })
      .immediate();
  }

  interrupt(lease: Lease): CleanupTicket {
    return this.db
      .transaction(() => {
        const row = this.row(lease.sessionId);
        matchLease(row, lease);
        return this.clean(row, 'interrupted');
      })
      .immediate();
  }

  pendingCleanup(): CleanupTicket | null {
    const row = this.occupied();
    return row && (row.state === 'cleaning' || row.state === 'quarantined')
      ? cleanupIdentity(row)
      : null;
  }

  completeCleanup(ticket: CleanupTicket, result: { verified: boolean; detail: string }): Session {
    if (
      typeof result.verified !== 'boolean' ||
      typeof result.detail !== 'string' ||
      !result.detail.trim() ||
      result.detail.length > 4096
    ) {
      throw new QueueError(
        'invalid_request',
        'Cleanup needs a verified flag and bounded nonempty diagnostic.',
      );
    }
    return this.db
      .transaction(() => {
        const row = this.matchCleanup(ticket);
        if (row.state !== 'cleaning') {
          throw new QueueError('invalid_state', 'Retry quarantined cleanup before completing it.');
        }
        this.db
          .query(
            `UPDATE sessions SET state=?, cleanupDetail=?, finished=?, cleanupToken=? WHERE id=?`,
          )
          .run(
            result.verified ? 'finished' : 'quarantined',
            result.detail,
            result.verified ? Date.now() : null,
            result.verified ? null : row.cleanupToken,
            row.id,
          );
        return this.get(row.id);
      })
      .immediate();
  }

  retryCleanup(ticket: CleanupTicket): CleanupTicket {
    return this.db
      .transaction(() => {
        const row = this.matchCleanup(ticket);
        if (row.state !== 'quarantined') {
          throw new QueueError('invalid_state', 'Only quarantined cleanup can be retried.');
        }
        const token = randomUUID();
        this.db
          .query("UPDATE sessions SET state='cleaning', cleanupToken=? WHERE id=?")
          .run(token, row.id);
        return { sessionId: row.id, generation: ticket.generation, token };
      })
      .immediate();
  }

  private row(id: string): Row {
    const row = this.db.query<Row, [string]>('SELECT * FROM sessions WHERE id=?').get(id);
    if (!row) {
      throw new QueueError('not_found', 'Unknown review session.');
    }
    return row;
  }

  private occupied(): Row | null {
    return this.db
      .query<Row, []>("SELECT * FROM sessions WHERE state IN ('active','cleaning','quarantined')")
      .get();
  }

  private active(lease: Lease): Row {
    const row = this.row(lease.sessionId);
    matchLease(row, lease);
    if (row.deadline === null || row.deadline <= Date.now()) {
      throw new QueueError('stale_lease', 'Review lease expired.');
    }
    return row;
  }

  private clean(row: Row, outcome: Outcome): CleanupTicket {
    if (row.generation === null) {
      throw new QueueError('invalid_state', 'Active session generation missing.');
    }
    const token = randomUUID();
    this.db
      .query(`UPDATE sessions SET state='cleaning', outcome=?, leaseToken=NULL,
      deadline=NULL, cleanupToken=? WHERE id=?`)
      .run(outcome, token, row.id);
    return { sessionId: row.id, generation: row.generation, token };
  }

  private matchCleanup(ticket: CleanupTicket): Row {
    const row = this.row(ticket.sessionId);
    if (row.generation !== ticket.generation || row.cleanupToken !== ticket.token) {
      throw new QueueError('stale_cleanup', 'Cleanup receipt no longer names the current attempt.');
    }
    return row;
  }
}
