import type { Database } from 'bun:sqlite';

import { QueueError } from '@repo/runtime/types/contracts';

export function initialize(db: Database): void {
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  db.transaction(() => {
    const version = db.query<{ user_version: number }, []>('PRAGMA user_version').get();
    if (version?.user_version === 1) {
      return;
    }
    if (version?.user_version !== 0) {
      throw new QueueError(
        'unsupported_schema',
        'Unsupported queue schema; open with a compatible runtime.',
      );
    }
    db.exec(`
      CREATE TABLE queue_meta (id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL);
      INSERT INTO queue_meta VALUES (1, 0);
      CREATE TABLE sessions (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        owner TEXT NOT NULL,
        requestId TEXT NOT NULL,
        project TEXT NOT NULL,
        workspace TEXT NOT NULL,
        revision TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued','active','cleaning','quarantined','finished','cancelled')),
        generation INTEGER,
        leaseToken TEXT,
        cleanupToken TEXT,
        deadline INTEGER,
        maxDeadline INTEGER,
        created INTEGER NOT NULL,
        finished INTEGER,
        outcome TEXT CHECK(outcome IN ('passed','failed','cancelled','expired','interrupted')),
        cleanupDetail TEXT,
        UNIQUE(owner, requestId)
      );
      CREATE UNIQUE INDEX native_slot ON sessions ((1))
        WHERE state IN ('active','cleaning','quarantined');
      PRAGMA user_version=1;
    `);
  }).immediate();
}
