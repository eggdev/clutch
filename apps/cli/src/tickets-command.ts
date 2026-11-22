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
import { checkDone, dispatch, sendStatusPrompt } from '@/tickets/dispatch';
import type { Driver } from '@/tickets/dispatch';
import { checkMerged } from '@/tickets/finish';
import { missingSkills, phaseFilePath, readPhaseFile } from '@/tickets/phases';
import { openStore, phaseNames, phaseStatuses } from '@/tickets/store';
import type { Event, TicketStore } from '@/tickets/store';

export const ticketsUsage = [
  'clutch tickets add <title> --description TEXT [--kind KIND] [--hold]',
  'clutch tickets list [--inbox] [--phase PHASE] [--status STATUS]',
  'clutch tickets show <id>',
  'clutch tickets ready',
  'clutch tickets edit <id> [--now TEXT] [--expected TEXT] [--location TEXT] [--acceptance TEXT]... [--major yes|no] [--kind KIND] [--depends ID,...] [--body-file PATH]',
  'clutch tickets route <id> --phases PHASE,... --reason TEXT',
  'clutch tickets hold <id> [--reason TEXT]',
  'clutch tickets release <id>',
  'clutch tickets claim <id> <phase> --as NAME [--thread THREAD]',
  'clutch tickets phase <id> <phase> <status> [--reason TEXT] [--approved-by owner --quote TEXT]',
  'clutch tickets link <id> --kind KIND <value>',
  'clutch tickets events [--ticket ID] [--since NUMBER]',
  'clutch tickets merged <id>',
  'clutch tickets dispatch',
  'clutch tickets phases [--check]',
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
  'approved-by': { type: 'string' },
  quote: { type: 'string' },
  check: { type: 'boolean' },
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

/** The checkout that holds `cwd`. Its `clutch.yaml` and phase file apply. */
async function rootOf(cwd: string) {
  const top = await git(cwd, 'rev-parse', '--show-toplevel');
  return top.ok ? top.out : cwd;
}

/** The driver of the project, or null when the checkout has no phase file. */
async function driverOf(store: TicketStore, cwd: string, values: Values): Promise<Driver | null> {
  const root = await rootOf(cwd);
  const file = await readPhaseFile(root);
  if (!file) {
    return null;
  }
  const loaded = await loadClutchConfig(root);
  return {
    store,
    file,
    actor: actorOf(values),
    project: loaded.kind === 'loaded' ? loaded.config.project : path.basename(root),
    // The store is `<git-common-dir>/clutch/tickets.sqlite`, in the main checkout.
    projectDir: path.dirname(path.dirname(path.dirname(store.file))),
    cwd: path.resolve(cwd),
  };
}

async function dispatched(store: TicketStore, cwd: string, values: Values) {
  const driver = await driverOf(store, cwd, values);
  return driver ? await dispatch(driver) : [];
}

/** The commands that run no dispatch after them. `dispatch` itself writes only through the driver. */
const reads: Record<string, [number, Handler]> = {
  dispatch: [
    0,
    async (store, _args, values, cwd) => ({ dispatch: await dispatched(store, cwd, values) }),
  ],
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
  merged: [1, (store, [id], _values, cwd) => checkMerged(store, id, cwd)],
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
  phases: [
    0,
    async (_store, _args, values, cwd) => {
      const root = await rootOf(cwd);
      const file = await readPhaseFile(root);
      if (!values.check) {
        return { file: phaseFilePath(root), phases: file };
      }
      if (!file) {
        throw new Error(`${phaseFilePath(root)} does not exist.`);
      }
      const missing = missingSkills(file, root);
      if (missing.length > 0) {
        throw new Error(missing.map((skill) => `The skill ${skill} is not installed.`).join('\n'));
      }
      return { status: 'ok', file: phaseFilePath(root) };
    },
  ],
};

/**
 * The commands that change the store. Each one writes an event for each record
 * that it changes. `run` dispatches after each one and prints what it returns.
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
  hold: [
    1,
    (store, [id], values) =>
      written(store, id, holdTicket(store, actorOf(values), id, values.reason ?? null)),
  ],
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
    async (store, [id, phase, status], values, cwd) => {
      const driver = await driverOf(store, cwd, values);
      let reason = values.reason ?? null;
      if (driver && status === 'done') {
        const approval = { approvedBy: values['approved-by'], quote: values.quote };
        reason = (await checkDone(driver, { id, phase, cwd, ...approval })) ?? reason;
      }
      const event = setPhase(store, actorOf(values), id, { phase, status, reason });
      const prompt = driver && event ? await sendStatusPrompt(driver, id, phase, status) : null;
      return { ...written(store, id, event), statusPrompt: prompt };
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
  const result = await command[1](store, rest, values, path.resolve(cwd));
  if (!(action in writes)) {
    return result;
  }
  // The write is saved, so a driver error goes in the output and the command still exits 0.
  const after = await dispatched(store, cwd, values).catch((error: Error) => ({
    status: 'error',
    message: error.message,
  }));
  const { ticket } = result as { ticket: { id: string } };
  return { ...result, ticket: shown(store, ticket.id), dispatch: after };
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
