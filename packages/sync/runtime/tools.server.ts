import type { Actor } from '@repo/identity/types/actor';
import type { ServerChange } from '@repo/sync/commands/server-change.server';
import type { CommandDeclaration } from '@repo/sync/contract/command';
import type { Contract } from '@repo/sync/contract/define';
import { stamped } from '@repo/sync/contract/fields';
import type { Load } from '@repo/sync/contract/record';
import { listLimit, toolsOf } from '@repo/sync/contract/tools';
import type { ToolDefinition } from '@repo/sync/contract/tools';
import { EventLog } from '@repo/sync/service/event-log';
import { settle } from '@repo/sync/service/settle';
import { SyncGroups } from '@repo/sync/service/sync-groups';
import type { Delta } from '@repo/sync/types/protocol';
import { Clock, Effect } from 'effect';

type Json = Readonly<Record<string, unknown>>;

/**
 * What a tool call gives back. An accepted write names its event and the
 * input that ran, with each stamp filled. A read gives its `data`. A refused
 * call has the stable code of its refusal and the reason, so an agent can
 * branch on the code and show the reason.
 */
export type ToolResult =
  | { readonly ok: true; readonly syncId: number; readonly input: Json }
  | { readonly ok: true; readonly data: Json }
  | { readonly ok: false; readonly code: string; readonly reason: string };

/** The agent tools of a server app: the list, and the one way to call each. */
export type AgentTools<R> = {
  readonly list: ReadonlyArray<ToolDefinition>;
  /**
   * Calls a tool as `actor`. `callId` names the call: a repeat of a write
   * with the same ID commits once, so an agent may send a call again after a
   * lost answer.
   */
  readonly call: (
    name: string,
    input: unknown,
    actor: Actor,
    callId: string,
  ) => Effect.Effect<ToolResult, never, R | EventLog | SyncGroups>;
};

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const refused = (code: string, reason: string): ToolResult => ({ ok: false, code, reason });

/**
 * The records of one model that a client holds after it loads one group:
 * each change of the group, in sync order, applied in turn.
 */
function recordsOf(deltas: ReadonlyArray<Delta>, model: string): Map<string, Json> {
  const records = new Map<string, Json>();
  for (const delta of deltas) {
    for (const change of delta.changes) {
      if (change.model === model && (change.action === 'delete' || change.data === null)) {
        records.delete(change.id);
      } else if (change.model === model) {
        records.set(change.id, { ...change.data, id: change.id });
      }
    }
  }
  return records;
}

/**
 * The records of the group that a read tool names, as the actor's own client
 * would load them. The actor needs the same access as `Load` on the sync
 * socket: a group that it may not load is refused.
 */
function loadFor(declared: Load, groupId: string, actor: Actor) {
  return Effect.gen(function* () {
    const group = declared.group(groupId);
    const groups = yield* SyncGroups;
    const allowed = yield* groups.groupsFor(actor);
    if (![...allowed.eager, ...allowed.lazy].includes(group)) {
      return refused('forbidden', `You may not read the records of this ${declared.prefix}.`);
    }
    const log = yield* EventLog;
    const head = yield* log.head(actor.organizationId);
    const deltas = yield* log.backfill(actor.organizationId, head, new Set([group]));
    return recordsOf(deltas, declared.record);
  });
}

/** One page of a list tool: the fields named, sorted by ID, after the cursor, up to the limit. */
function page(records: Map<string, Json>, fields: ReadonlyArray<string>, input: Json): ToolResult {
  const asked = typeof input.limit === 'number' ? Math.trunc(input.limit) : listLimit.usual;
  const limit = Math.min(Math.max(asked, 1), listLimit.most);
  const cursor = typeof input.cursor === 'string' ? input.cursor : '';
  const after = [...records.keys()].toSorted().filter((id) => id > cursor);
  const ids = after.slice(0, limit);
  const hasMore = after.length > ids.length;
  return {
    ok: true,
    data: {
      items: ids.map((id) => ({
        id,
        ...Object.fromEntries(fields.map((field) => [field, records.get(id)?.[field] ?? null])),
      })),
      pagination: {
        hasMore,
        nextCursor: hasMore ? (ids.at(-1) ?? null) : null,
        itemsReturned: ids.length,
        limit,
      },
    },
  };
}

/** Runs a read tool: a page of the group, or one whole record of it. */
function read(tool: ToolDefinition, declared: Load, input: Json, actor: Actor) {
  return Effect.gen(function* () {
    if (typeof input.id !== 'string') {
      return refused(
        'invalid-input',
        `${tool.name} needs \`id\`, the ID of the ${declared.prefix}.`,
      );
    }
    const records = yield* loadFor(declared, input.id, actor);
    if (!(records instanceof Map)) {
      return records;
    }
    if (tool.target.kind === 'list') {
      return page(records, tool.target.fields, input);
    }
    const found = typeof input.record === 'string' ? records.get(input.record) : undefined;
    return found
      ? ({ ok: true, data: found } satisfies ToolResult)
      : refused(
          'not-found',
          `This ${declared.prefix} has no ${declared.record} with that ID. Call the list tool to see the IDs.`,
        );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError(`The read tool ${tool.name} failed`, cause).pipe(
        Effect.as(refused('failed', 'The server could not read these records.')),
      ),
    ),
  );
}

/** Runs a write tool: the server change of its command, through the event log. */
function write<R>(
  change: ServerChange<R> | undefined,
  declared: CommandDeclaration,
  input: Json,
  actor: Actor,
  callId: string,
) {
  return Effect.gen(function* () {
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    const filled = stamped(declared.input, input, {
      newId: () => crypto.randomUUID(),
      now: () => now,
    });
    // A tool call has no queue that could keep the write, so an outage is an answer.
    const outcome = yield* settle(
      change,
      { id: `tool:${callId}`, command: declared.name, input: filled },
      actor,
    ).pipe(Effect.catchTag('ServerUnavailable', () => Effect.void));
    if (!outcome) {
      return refused(
        'failed',
        'The server could not reach its database, so nothing changed. Try again.',
      );
    }
    return outcome.status === 'accepted' && outcome.syncId !== null
      ? ({ ok: true, syncId: outcome.syncId, input: filled } satisfies ToolResult)
      : refused(
          outcome.code ?? 'failed',
          outcome.reason ?? 'The server could not apply this change.',
        );
  });
}

/**
 * The agent tools of a server app, made from its contracts. A write runs the
 * server change of its command through the event log, as the sync socket
 * does: the same input check, the same access rule, the same refusals, and a
 * delta for each client. A read gives the records that the actor's own
 * client gets when it loads the group. A tool has no handler of its own, so
 * it cannot hold a rule that the screen does not have. An MCP server lists
 * `list` and passes each call to `call`. See
 * docs/contributing/architecture/mcp.md.
 */
export function agentTools<R>(
  changes: ReadonlyArray<ServerChange<R>>,
  contracts: ReadonlyArray<Contract>,
): AgentTools<R> {
  const list = toolsOf(contracts);
  const tools = new Map(list.map((tool) => [tool.name, tool]));
  const serverChanges = new Map(changes.map((change) => [change.name, change]));
  const commands = new Map(
    contracts.flatMap((contract) => contract.commands).map((declared) => [declared.name, declared]),
  );
  const loads = new Map(
    contracts.flatMap((contract) => contract.loads).map((declared) => [declared.name, declared]),
  );
  return {
    list,
    call: (name, input, actor, callId) => {
      const tool = tools.get(name);
      if (!tool) {
        return Effect.succeed(
          refused('unknown-command', `No tool is named ${name}. List the tools to see each one.`),
        );
      }
      if (!isObject(input)) {
        return Effect.succeed(
          refused(
            'invalid-input',
            `The input of ${name} is an object with the fields of its schema.`,
          ),
        );
      }
      const { target } = tool;
      if (target.kind === 'command') {
        const declared = commands.get(target.command);
        return declared
          ? write(serverChanges.get(declared.name), declared, input, actor, callId)
          : Effect.succeed(refused('unknown-command', `No command is named ${target.command}.`));
      }
      const declared = loads.get(target.load);
      return declared
        ? read(tool, declared, input, actor)
        : Effect.succeed(refused('unknown-command', `No load function is named ${target.load}.`));
    },
  };
}
