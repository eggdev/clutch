import { changedFrom, kinds, linkKinds, phaseNames, phaseStatuses } from '@/tickets/store';
import type {
  Change,
  Event,
  Phase,
  PhaseName,
  PhaseStatus,
  Ticket,
  TicketStore,
} from '@/tickets/store';

const now = () => new Date().toISOString();

/** `value` when it is one of `allowed`. Otherwise an error that names each choice. */
export function oneOf<T extends string>(name: string, allowed: ReadonlyArray<T>, value: string) {
  if (!(allowed as ReadonlyArray<string>).includes(value)) {
    throw new Error(`${name} must be one of ${allowed.join(', ')}. Got ${value}.`);
  }
  return value as T;
}

/** The fields that `edit` sets. No command changes `description`: it holds the owner's words. */
export type Edit = Partial<
  Pick<Ticket, 'now' | 'expected' | 'location' | 'acceptance' | 'major' | 'body'> & {
    kind: string;
    dependsOn: Array<string>;
  }
>;

/** The fields of `Edit` that are a plain column of `tickets`. */
const columns = ['now', 'expected', 'location', 'kind', 'body'] as const;

function ticketChange(store: TicketStore, before: Ticket): Change {
  const data = store.ticket(before.id);
  return { type: 'Ticket', action: 'update', data, updatedFrom: changedFrom(before, data) };
}

function setStatus(store: TicketStore, id: string, phase: PhaseName, status: PhaseStatus) {
  store.db
    .query('UPDATE phases SET status = ? WHERE ticket = ? AND phase = ?')
    .run(status, id, phase);
}

/**
 * Makes the first phase that is not `done` ready, when it is `not_ready` and
 * the ticket is not held. So `done` in one phase makes the next one ready.
 */
function advance(store: TicketStore, id: string) {
  if (store.ticket(id).hold) {
    return;
  }
  const next = store.phases(id).find((row) => row.status !== 'done');
  if (next?.status === 'not_ready') {
    setStatus(store, id, next.phase, 'ready');
  }
}

/** Adds a ticket with the next id and one `triage` phase, `not_ready` when held. */
export function addTicket(
  store: TicketStore,
  actor: string,
  input: Pick<Ticket, 'title' | 'description' | 'hold' | 'source'> & {
    kind: string | null;
    prefix: string;
  },
) {
  const kind = input.kind === null ? null : oneOf('kind', kinds, input.kind);
  return store.write(actor, () => {
    const { next } = store.db
      .query<{ next: number }, []>('SELECT COALESCE(MAX(number), 999) + 1 AS next FROM tickets')
      .get() ?? { next: 1000 };
    const id = `${input.prefix}-${next}`;
    store.db
      .query(
        `INSERT INTO tickets (number, id, title, description, kind, source, hold, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(next, id, input.title, input.description, kind, input.source, input.hold ? 1 : 0, now());
    store.db
      .query("INSERT INTO phases (ticket, phase, status) VALUES (?, 'triage', ?)")
      .run(id, input.hold ? 'not_ready' : 'ready');
    return { type: 'Ticket', action: 'create', data: store.ticket(id), updatedFrom: {} };
  }) as Event;
}

export function editTicket(store: TicketStore, actor: string, id: string, edit: Edit) {
  if (edit.kind !== undefined) {
    oneOf('kind', kinds, edit.kind);
  }
  return store.write(actor, () => {
    const before = store.ticket(id);
    for (const column of columns) {
      const value = edit[column];
      if (value !== undefined) {
        store.db.query(`UPDATE tickets SET ${column} = ? WHERE id = ?`).run(value, id);
      }
    }
    if (edit.acceptance !== undefined) {
      store.db
        .query('UPDATE tickets SET acceptance = ? WHERE id = ?')
        .run(JSON.stringify(edit.acceptance), id);
    }
    if (edit.major !== undefined) {
      store.db.query('UPDATE tickets SET major = ? WHERE id = ?').run(edit.major ? 1 : 0, id);
    }
    if (edit.dependsOn !== undefined) {
      store.db.query('DELETE FROM depends_on WHERE ticket = ?').run(id);
      for (const dependency of edit.dependsOn) {
        if (dependency === id) {
          throw new Error(`${id} cannot depend on itself.`);
        }
        store.ticket(dependency);
        store.db.query('INSERT INTO depends_on VALUES (?, ?)').run(id, dependency);
      }
    }
    return ticketChange(store, before);
  });
}

/** The requirements that a route with no `planning` phase still needs. Empty when it has them all. */
function missingForNoPlanning(ticket: Ticket) {
  return [
    ticket.now ? [] : ['now'],
    ticket.expected ? [] : ['expected'],
    ticket.location ? [] : ['location'],
    ticket.acceptance.length > 0 ? [] : ['acceptance (at least one check)'],
    ticket.major === false ? [] : ['major: no'],
  ].flat();
}

/**
 * Sets the route. It starts with `triage`, and lists each phase once, in the
 * order of `phaseNames`. A phase that joins the route starts `not_ready`, and a
 * phase that leaves it loses its row.
 */
export function routeTicket(
  store: TicketStore,
  actor: string,
  id: string,
  route: { phases: Array<string>; reason: string },
) {
  const phases = route.phases[0] === 'triage' ? route.phases : ['triage', ...route.phases];
  for (const [index, phase] of phases.entries()) {
    if (!(phaseNames as ReadonlyArray<string>).includes(phase)) {
      throw new Error(`Each phase must be one of ${phaseNames.join(', ')}. Got ${phase}.`);
    }
    if (
      index > 0 &&
      phaseNames.indexOf(phase as PhaseName) <= phaseNames.indexOf(phases[index - 1] as PhaseName)
    ) {
      throw new Error(`List each phase once, in this order: ${phaseNames.join(', ')}.`);
    }
  }
  return store.write(actor, () => {
    const before = store.ticket(id);
    const missing = phases.includes('planning') ? [] : missingForNoPlanning(before);
    if (missing.length > 0) {
      throw Object.assign(
        new Error(`A route with no planning phase needs these first: ${missing.join(', ')}.`),
        { missing },
      );
    }
    store.db
      .query('UPDATE tickets SET route = ?, route_reason = ? WHERE id = ?')
      .run(JSON.stringify(phases), route.reason, id);
    store.db
      .query(
        `DELETE FROM phases WHERE ticket = ? AND phase NOT IN (SELECT value FROM json_each(?))`,
      )
      .run(id, JSON.stringify(phases));
    for (const phase of phases) {
      store.db
        .query("INSERT OR IGNORE INTO phases (ticket, phase, status) VALUES (?, ?, 'not_ready')")
        .run(id, phase);
    }
    advance(store, id);
    return ticketChange(store, before);
  });
}

/** Holds a ticket: each `ready` phase goes back to `not_ready`. */
export function holdTicket(store: TicketStore, actor: string, id: string) {
  return store.write(actor, () => {
    const before = store.ticket(id);
    store.db.query('UPDATE tickets SET hold = 1 WHERE id = ?').run(id);
    store.db
      .query("UPDATE phases SET status = 'not_ready' WHERE ticket = ? AND status = 'ready'")
      .run(id);
    return ticketChange(store, before);
  });
}

/** Releases a held ticket: its first phase that is not done becomes `ready`. */
export function releaseTicket(store: TicketStore, actor: string, id: string) {
  return store.write(actor, () => {
    const before = store.ticket(id);
    store.db.query('UPDATE tickets SET hold = 0 WHERE id = ?').run(id);
    advance(store, id);
    return ticketChange(store, before);
  });
}

function phaseChange(store: TicketStore, before: Phase): Change {
  const data = store.phase(before.id, before.phase);
  return { type: 'Phase', action: 'update', data, updatedFrom: changedFrom(before, data) };
}

/** Claims a `ready` phase: one transaction sets `in_progress` and the claim, so only one claim wins. */
export function claimPhase(
  store: TicketStore,
  actor: string,
  id: string,
  phase: string,
  thread: string | null,
) {
  return store.write(actor, () => {
    const before = store.phase(id, phase);
    if (before.status !== 'ready') {
      const by = before.claimedBy ? `, claimed by ${before.claimedBy}` : '';
      throw new Error(
        `${id} ${phase} is ${before.status}${by}. Only a ready phase can be claimed.`,
      );
    }
    store.db
      .query(
        `UPDATE phases SET status = 'in_progress', claimed_by = ?, thread = ?, started_at = ?,
         finished_at = NULL, blocked_reason = NULL WHERE ticket = ? AND phase = ?`,
      )
      .run(actor, thread, now(), id, phase);
    return phaseChange(store, before);
  }) as Event;
}

/** Saves the thread of a phase that `actor` claimed, once its thread has started. */
export function setThread(
  store: TicketStore,
  actor: string,
  id: string,
  change: { phase: string; thread: string },
) {
  return store.write(actor, () => {
    const before = store.phase(id, change.phase);
    if (before.status !== 'in_progress' || before.claimedBy !== actor) {
      throw new Error(`${id} ${change.phase} is not in progress with a claim by ${actor}.`);
    }
    store.db
      .query('UPDATE phases SET thread = ? WHERE ticket = ? AND phase = ?')
      .run(change.thread, id, before.phase);
    return phaseChange(store, before);
  });
}

/**
 * Sets the status of a phase. `done` makes the next phase ready. `ready` drops
 * the claim and sets every later phase to `not_ready`, so the work runs again
 * in order.
 */
export function setPhase(
  store: TicketStore,
  actor: string,
  id: string,
  change: { phase: string; status: string; reason: string | null },
) {
  oneOf('status', phaseStatuses, change.status);
  return store.write(actor, () => {
    const before = store.phase(id, change.phase);
    const time = now();
    store.db
      .query(
        `UPDATE phases SET status = ?1, blocked_reason = ?2,
         started_at = CASE WHEN ?1 = 'in_progress' THEN COALESCE(started_at, ?3) ELSE started_at END,
         finished_at = CASE WHEN ?1 = 'done' THEN ?3 ELSE NULL END
         WHERE ticket = ?4 AND phase = ?5`,
      )
      .run(change.status, change.reason, time, id, before.phase);
    if (change.status === 'ready') {
      store.db
        .query('UPDATE phases SET claimed_by = NULL, thread = NULL WHERE ticket = ? AND phase = ?')
        .run(id, before.phase);
      for (const later of store.phases(id)) {
        if (phaseNames.indexOf(later.phase) > phaseNames.indexOf(before.phase)) {
          setStatus(store, id, later.phase, 'not_ready');
        }
      }
    }
    if (change.status === 'done') {
      advance(store, id);
    }
    return phaseChange(store, before);
  });
}

export function linkTicket(
  store: TicketStore,
  actor: string,
  id: string,
  link: { kind: string; value: string },
) {
  oneOf('link kind', linkKinds, link.kind);
  return store.write(actor, () => {
    const before = store.ticket(id);
    store.db.query('INSERT OR IGNORE INTO links VALUES (?, ?, ?)').run(id, link.kind, link.value);
    return ticketChange(store, before);
  });
}

/** A ticket is done when it has phases and each one is `done`. */
function isDone(store: TicketStore, id: string) {
  const rows = store.phases(id);
  return rows.length > 0 && rows.every((row) => row.status === 'done');
}

/** Each `ready` phase of a ticket that is not held and whose dependencies are done. */
export function readyPhases(store: TicketStore) {
  return store.ids().flatMap((id) => {
    const ticket = store.ticket(id);
    if (ticket.hold || !ticket.dependsOn.every((dependency) => isDone(store, dependency))) {
      return [];
    }
    return store
      .phases(id)
      .filter((row) => row.status === 'ready')
      .map((row) => ({ ...row, title: ticket.title }));
  });
}
