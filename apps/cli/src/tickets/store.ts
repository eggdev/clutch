import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { git } from '@/git';

export const phaseNames = ['triage', 'planning', 'design', 'build', 'review', 'deploy'] as const;
export const phaseStatuses = [
  'not_ready',
  'ready',
  'in_progress',
  'blocked',
  'in_review',
  'done',
] as const;
export const kinds = ['bug', 'feature', 'chore'] as const;
export const linkKinds = ['prototype', 'pull_request', 'branch', 'worktree', 'evidence'] as const;

export type PhaseName = (typeof phaseNames)[number];
export type PhaseStatus = (typeof phaseStatuses)[number];

export type Phase = {
  id: string;
  phase: PhaseName;
  status: PhaseStatus;
  claimedBy: string | null;
  thread: string | null;
  blockedReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type Ticket = {
  id: string;
  title: string;
  description: string;
  kind: (typeof kinds)[number] | null;
  source: string | null;
  now: string | null;
  expected: string | null;
  location: string | null;
  acceptance: Array<string>;
  major: boolean | null;
  route: Array<PhaseName>;
  routeReason: string | null;
  hold: boolean;
  body: string;
  dependsOn: Array<string>;
  links: Array<{ kind: (typeof linkKinds)[number]; value: string }>;
  createdAt: string;
};

/** One change, in the shape of the Linear webhook, so a webhook task can filter on it. */
export type Event = {
  number: number;
  deliveryId: string;
  createdAt: string;
  actor: string;
  type: 'Ticket' | 'Phase';
  action: 'create' | 'update';
  data: Ticket | Phase;
  updatedFrom: Record<string, unknown>;
};

export type Change = Pick<Event, 'type' | 'action' | 'data' | 'updatedFrom'>;

type TicketRow = Omit<
  Ticket,
  'acceptance' | 'major' | 'route' | 'routeReason' | 'hold' | 'dependsOn' | 'links' | 'createdAt'
> & {
  acceptance: string;
  major: number | null;
  route: string;
  route_reason: string | null;
  hold: number;
  created_at: string;
};

type PhaseRow = {
  ticket: string;
  phase: PhaseName;
  status: PhaseStatus;
  claimed_by: string | null;
  thread: string | null;
  blocked_reason: string | null;
  started_at: string | null;
  finished_at: string | null;
};

type EventRow = {
  number: number;
  delivery_id: string;
  created_at: string;
  actor: string;
  type: Event['type'];
  action: Event['action'];
  data: string;
  updated_from: string;
};

const list = (values: ReadonlyArray<string>) => values.map((value) => `'${value}'`).join(',');

const schema = `
  CREATE TABLE tickets (
    number INTEGER PRIMARY KEY CHECK(number >= 1000),
    id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    kind TEXT CHECK(kind IN (${list(kinds)})),
    source TEXT,
    now TEXT,
    expected TEXT,
    location TEXT,
    acceptance TEXT NOT NULL DEFAULT '[]',
    major INTEGER CHECK(major IN (0, 1)),
    route TEXT NOT NULL DEFAULT '[]',
    route_reason TEXT,
    hold INTEGER NOT NULL DEFAULT 0 CHECK(hold IN (0, 1)),
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE phases (
    ticket TEXT NOT NULL REFERENCES tickets(id),
    phase TEXT NOT NULL CHECK(phase IN (${list(phaseNames)})),
    status TEXT NOT NULL CHECK(status IN (${list(phaseStatuses)})),
    claimed_by TEXT,
    thread TEXT,
    blocked_reason TEXT,
    started_at TEXT,
    finished_at TEXT,
    PRIMARY KEY (ticket, phase)
  );
  CREATE TABLE depends_on (
    ticket TEXT NOT NULL REFERENCES tickets(id),
    depends_on TEXT NOT NULL REFERENCES tickets(id),
    PRIMARY KEY (ticket, depends_on)
  );
  CREATE TABLE links (
    ticket TEXT NOT NULL REFERENCES tickets(id),
    kind TEXT NOT NULL CHECK(kind IN (${list(linkKinds)})),
    value TEXT NOT NULL,
    PRIMARY KEY (ticket, kind, value)
  );
  CREATE TABLE events (
    number INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket TEXT NOT NULL,
    delivery_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    actor TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('Ticket', 'Phase')),
    action TEXT NOT NULL CHECK(action IN ('create', 'update')),
    data TEXT NOT NULL,
    updated_from TEXT NOT NULL
  );
  CREATE INDEX events_ticket ON events (ticket, number);
  PRAGMA user_version=1;
`;

/** The old value of each field that differs between `before` and `after`. */
export function changedFrom<T extends object>(before: T, after: T) {
  const old: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(before)) {
    if (JSON.stringify(value) !== JSON.stringify(after[key as keyof T])) {
      old[key] = value;
    }
  }
  return old;
}

function toPhase(row: PhaseRow): Phase {
  return {
    id: row.ticket,
    phase: row.phase,
    status: row.status,
    claimedBy: row.claimed_by,
    thread: row.thread,
    blockedReason: row.blocked_reason,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toEvent(row: EventRow): Event {
  return {
    number: row.number,
    deliveryId: row.delivery_id,
    createdAt: row.created_at,
    actor: row.actor,
    type: row.type,
    action: row.action,
    data: JSON.parse(row.data) as Event['data'],
    updatedFrom: JSON.parse(row.updated_from) as Event['updatedFrom'],
  };
}

/**
 * The ticket store of one project: a SQLite file that only the Clutch CLI
 * reads and writes. Each worktree of the project opens the same file.
 */
export class TicketStore implements Disposable {
  readonly db: Database;
  readonly file: string;

  constructor(file: string) {
    this.file = file;
    this.db = new Database(file, { create: true, strict: true });
    try {
      this.db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
      this.db
        .transaction(() => {
          const { user_version: version } = this.db
            .query<{ user_version: number }, []>('PRAGMA user_version')
            .get() ?? { user_version: 0 };
          if (version === 0) {
            this.db.exec(schema);
          } else if (version !== 1) {
            throw new Error(`${file} has schema ${version}. Update Clutch to read it.`);
          }
        })
        .immediate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  [Symbol.dispose]() {
    this.db.close();
  }

  /**
   * Runs `change` and writes its event in one immediate transaction, so a
   * change and its event commit together or not at all. An update that
   * changes no field writes no event and returns null.
   */
  write(actor: string, change: () => Change): Event | null {
    return this.db
      .transaction(() => {
        const { type, action, data, updatedFrom } = change();
        if (action === 'update' && Object.keys(updatedFrom).length === 0) {
          return null;
        }
        const row = this.db
          .query<EventRow, Array<string>>(
            `INSERT INTO events (ticket, delivery_id, created_at, actor, type, action, data, updated_from)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
          )
          .get(
            data.id,
            randomUUID(),
            new Date().toISOString(),
            actor,
            type,
            action,
            JSON.stringify(data),
            JSON.stringify(updatedFrom),
          );
        return toEvent(row as EventRow);
      })
      .immediate();
  }

  ticket(id: string): Ticket {
    const row = this.db.query<TicketRow, [string]>('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!row) {
      throw new Error(`No ticket ${id}.`);
    }
    const {
      number: _number,
      acceptance,
      major,
      route,
      route_reason,
      hold,
      created_at,
      ...rest
    } = row as TicketRow & { number: number };
    return {
      ...rest,
      acceptance: JSON.parse(acceptance) as Array<string>,
      major: major === null ? null : major === 1,
      route: JSON.parse(route) as Array<PhaseName>,
      routeReason: route_reason,
      hold: hold === 1,
      dependsOn: this.db
        .query<{ depends_on: string }, [string]>(
          'SELECT depends_on FROM depends_on WHERE ticket = ? ORDER BY depends_on',
        )
        .all(id)
        .map((dependency) => dependency.depends_on),
      links: this.db
        .query<Ticket['links'][number], [string]>(
          'SELECT kind, value FROM links WHERE ticket = ? ORDER BY rowid',
        )
        .all(id),
      createdAt: created_at,
    };
  }

  /** The ids of every ticket, oldest first. */
  ids(): Array<string> {
    return this.db
      .query<{ id: string }, []>('SELECT id FROM tickets ORDER BY number')
      .all()
      .map((row) => row.id);
  }

  /** The phase rows of a ticket, in route order. */
  phases(id: string): Array<Phase> {
    return this.db
      .query<PhaseRow, [string]>('SELECT * FROM phases WHERE ticket = ?')
      .all(id)
      .map(toPhase)
      .toSorted((a, b) => phaseNames.indexOf(a.phase) - phaseNames.indexOf(b.phase));
  }

  phase(id: string, phase: string): Phase {
    const row = this.phases(this.ticket(id).id).find((candidate) => candidate.phase === phase);
    if (!row) {
      throw new Error(`${id} has no ${phase} phase on its route.`);
    }
    return row;
  }

  events(filter: { ticket?: string; since?: number } = {}): Array<Event> {
    return this.db
      .query<EventRow, [string | null, string | null, number]>(
        'SELECT * FROM events WHERE (? IS NULL OR ticket = ?) AND number > ? ORDER BY number',
      )
      .all(filter.ticket ?? null, filter.ticket ?? null, filter.since ?? 0)
      .map((row) => toEvent(row));
  }
}

/** `<git-common-dir>/clutch/tickets.sqlite`: one file for every worktree of the project. */
export async function storeFile(cwd: string) {
  const common = await git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  if (!common.ok) {
    throw new Error('clutch tickets runs inside a git checkout of the project.');
  }
  return path.join(common.out, 'clutch', 'tickets.sqlite');
}

export async function openStore(cwd: string) {
  const file = await storeFile(cwd);
  await mkdir(path.dirname(file), { recursive: true });
  return new TicketStore(file);
}
