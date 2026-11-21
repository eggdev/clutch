import { readFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { loadClutchConfig } from '@/clutch-config/load';
import { git } from '@/git';
import {
  addTicket,
  claimPhase,
  editTicket,
  holdTicket,
  linkTicket,
  oneOf,
  readyPhases,
  releaseTicket,
  routeTicket,
  setPhase,
} from '@/tickets/change';
import type { Edit } from '@/tickets/change';
import { openStore, phaseNames, phaseStatuses } from '@/tickets/store';
import type { Event, TicketStore } from '@/tickets/store';

export const ticketsUsage = [
  'clutch tickets add <title> --description TEXT [--kind KIND] [--hold]',
  'clutch tickets list [--inbox] [--phase PHASE] [--status STATUS]',
  'clutch tickets show <id>',
  'clutch tickets ready',
  'clutch tickets edit <id> [--now TEXT] [--expected TEXT] [--location TEXT] [--acceptance TEXT]... [--major yes|no] [--kind KIND] [--depends ID,...] [--body-file PATH]',
  'clutch tickets route <id> --phases PHASE,... --reason TEXT',
  'clutch tickets hold <id>',
  'clutch tickets release <id>',
  'clutch tickets claim <id> <phase> --as NAME [--thread THREAD]',
  'clutch tickets phase <id> <phase> <status> [--reason TEXT]',
  'clutch tickets link <id> --kind KIND <value>',
  'clutch tickets events [--ticket ID] [--since NUMBER]',
].join('\n');

const options = {
  description: { type: 'string' },
  kind: { type: 'string' },
  hold: { type: 'boolean' },
  inbox: { type: 'boolean' },
  phase: { type: 'string' },
  status: { type: 'string' },
  now: { type: 'string' },
  expected: { type: 'string' },
  location: { type: 'string' },
  acceptance: { type: 'string', multiple: true },
  major: { type: 'string' },
  depends: { type: 'string' },
  'body-file': { type: 'string' },
  phases: { type: 'string' },
  reason: { type: 'string' },
  as: { type: 'string' },
  thread: { type: 'string' },
  ticket: { type: 'string' },
  since: { type: 'string' },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof options }>>['values'];
type Handler = (
  store: TicketStore,
  args: Array<string>,
  values: Values,
  cwd: string,
) => object | Promise<object>;

function required(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Pass ${name}.\nUsage:\n${ticketsUsage}`);
  }
  return value;
}

/** Who made a change: `--as`, or the user of the machine. */
const actorOf = (values: Values) => values.as ?? userInfo().username;

function shown(store: TicketStore, id: string) {
  return { ...store.ticket(id), phases: store.phases(id) };
}

const written = (store: TicketStore, id: string, event: Event | null) => ({
  ticket: shown(store, id),
  event,
});

/** `tickets.prefix` in clutch.yaml: the part of a ticket id before the number. */
async function prefixOf(cwd: string) {
  const top = await git(cwd, 'rev-parse', '--show-toplevel');
  const loaded = await loadClutchConfig(top.ok ? top.out : cwd);
  if (loaded.kind !== 'loaded' || !loaded.config.tickets) {
    throw new Error('Set tickets.prefix in clutch.yaml, such as `tickets: { prefix: CL }`.');
  }
  return loaded.config.tickets.prefix;
}

const reads: Record<string, [number, Handler]> = {
  list: [
    0,
    (store, _args, values) => {
      const { phase, status } = values;
      if (phase !== undefined) {
        oneOf('--phase', phaseNames, phase);
      }
      if (status !== undefined) {
        oneOf('--status', phaseStatuses, status);
      }
      const tickets = store
        .ids()
        .map((id) => shown(store, id))
        .filter((ticket) => !values.inbox || ticket.route.length === 0)
        .filter(
          (ticket) =>
            (!phase && !status) ||
            ticket.phases.some(
              (row) => (!phase || row.phase === phase) && (!status || row.status === status),
            ),
        );
      return { tickets };
    },
  ],
  show: [1, (store, [id]) => ({ ticket: shown(store, id) })],
  ready: [0, (store) => ({ phases: readyPhases(store) })],
  events: [
    0,
    (store, _args, values) => {
      const since = values.since === undefined ? 0 : Number(values.since);
      if (!Number.isInteger(since) || since < 0) {
        throw new Error(`--since must be an event number. Got ${values.since}.`);
      }
      return { events: store.events({ ticket: values.ticket, since }) };
    },
  ],
};

/**
 * The commands that change the store. Each one writes at most one event, and
 * `run` prints what it returns.
 */
const writes: Record<string, [number, Handler]> = {
  add: [
    1,
    async (store, [title], values, cwd) => {
      const event = addTicket(store, actorOf(values), {
        prefix: await prefixOf(cwd),
        title,
        description: required('--description', values.description),
        kind: values.kind ?? null,
        hold: values.hold === true,
        source: values.thread ?? actorOf(values),
      });
      return written(store, event.data.id, event);
    },
  ],
  edit: [
    1,
    async (store, [id], values) => {
      const edit: Edit = {
        now: values.now,
        expected: values.expected,
        location: values.location,
        acceptance: values.acceptance,
        kind: values.kind,
        major:
          values.major === undefined
            ? undefined
            : oneOf('--major', ['yes', 'no'], values.major) === 'yes',
        dependsOn: values.depends
          ?.split(',')
          .map((dependency) => dependency.trim())
          .filter(Boolean),
        body:
          values['body-file'] === undefined
            ? undefined
            : await readFile(values['body-file'], 'utf-8'),
      };
      return written(store, id, editTicket(store, actorOf(values), id, edit));
    },
  ],
  route: [
    1,
    (store, [id], values) => {
      const phases = required('--phases', values.phases)
        .split(',')
        .map((phase) => phase.trim());
      const reason = required('--reason', values.reason);
      return written(store, id, routeTicket(store, actorOf(values), id, { phases, reason }));
    },
  ],
  hold: [1, (store, [id], values) => written(store, id, holdTicket(store, actorOf(values), id))],
  release: [
    1,
    (store, [id], values) => written(store, id, releaseTicket(store, actorOf(values), id)),
  ],
  claim: [
    2,
    (store, [id, phase], values) => {
      const event = claimPhase(
        store,
        required('--as', values.as),
        id,
        phase,
        values.thread ?? null,
      );
      return written(store, id, event);
    },
  ],
  phase: [
    3,
    (store, [id, phase, status], values) => {
      const change = { phase, status, reason: values.reason ?? null };
      return written(store, id, setPhase(store, actorOf(values), id, change));
    },
  ],
  link: [
    2,
    (store, [id, value], values) => {
      const kind = required('--kind', values.kind);
      return written(store, id, linkTicket(store, actorOf(values), id, { kind, value }));
    },
  ],
};

async function run(args: Array<string>, cwd: string) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options });
  const [action = '', ...rest] = positionals;
  const command = reads[action] ?? writes[action];
  if (!command || command[0] !== rest.length) {
    throw new Error(`Usage:\n${ticketsUsage}`);
  }
  using store = await openStore(cwd);
  return await command[1](store, rest, values, path.resolve(cwd));
}

/** `clutch tickets`: the ticket store that every worktree of the project shares. */
export async function ticketsCommand(args: Array<string>, cwd: string): Promise<number> {
  try {
    console.log(JSON.stringify({ schemaVersion: 1, ...(await run(args, cwd)) }));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { missing } = error as { missing?: Array<string> };
    console.log(JSON.stringify({ schemaVersion: 1, status: 'error', message, missing }));
    return 1;
  }
}
