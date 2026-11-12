import { Actors } from '@repo/identity/service/actors';
import type { Actor } from '@repo/identity/types/actor';
import type { ServerChange } from '@repo/sync/commands/server-change.server';
import { originAllowed, syncOrigins } from '@repo/sync/config/origins';
import type { Contract } from '@repo/sync/contract/define';
import { route } from '@repo/sync/contract/route';
import { agentTools } from '@repo/sync/runtime/tools.server';
import type { AgentTools, ToolResult } from '@repo/sync/runtime/tools.server';
import type { EventLog } from '@repo/sync/service/event-log';
import { defineRoute } from '@repo/sync/service/routes';
import type { Route } from '@repo/sync/service/routes';
import type { SyncGroups } from '@repo/sync/service/sync-groups';
import { Effect, Option } from 'effect';
import { HttpServerResponse } from 'effect/http';

/** The protocol version that answers a client which names none. */
const defaultProtocolVersion = '2025-06-18';

/** What the server tells a client at its start. See docs/contributing/architecture/mcp.md. */
const instructions =
  'Each tool runs one command of the product, as the signed-in person. A refused call gives a stable code and a reason. Pass the same id again to repeat a call safely.';

/** The ID of a JSON-RPC message. A notification has none. */
type RpcId = string | number | null;

/** A JSON-RPC message with the fields that this route reads. `id` is undefined for a notification. */
type Message = {
  readonly id: RpcId | undefined;
  readonly method: string;
  readonly params: unknown;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRpcId = (value: unknown): value is RpcId =>
  value === null || typeof value === 'string' || typeof value === 'number';

/** Reads a JSON-RPC 2.0 request or notification, or gives nothing when the value is neither. */
function messageOf(value: unknown): Message | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { id, jsonrpc, method, params } = value;
  if (jsonrpc !== '2.0' || typeof method !== 'string') {
    return undefined;
  }
  if (id !== undefined && !isRpcId(id)) {
    return undefined;
  }
  return { id, method, params };
}

/** The name and the input of a `tools/call` request, or nothing when it names no tool. */
function callOf(params: unknown): { readonly name: string; readonly input: unknown } | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  const { name, arguments: input } = params;
  if (typeof name !== 'string') {
    return undefined;
  }
  return { name, input: input ?? {} };
}

/** The `initialize` result: the client's protocol version when it names one, and the tools. */
function initializeResult(params: unknown) {
  const requested = isRecord(params) ? params.protocolVersion : undefined;
  return {
    protocolVersion: typeof requested === 'string' ? requested : defaultProtocolVersion,
    capabilities: { tools: {} },
    serverInfo: { name: 'clutch', version: '1' },
    instructions,
  };
}

/** A JSON-RPC result with the request's ID. */
const answer = (id: RpcId, result: unknown) =>
  HttpServerResponse.jsonUnsafe({ jsonrpc: '2.0', id, result });

/** A JSON-RPC error with the request's ID, and the HTTP status that the error needs. */
const failure = (id: RpcId, code: number, message: string, status = 200) =>
  HttpServerResponse.jsonUnsafe({ jsonrpc: '2.0', id, error: { code, message } }, { status });

/** The result of a tool call: a text for the model, and the structured data for a program. */
function toolResultOf(result: ToolResult) {
  if (!result.ok) {
    return {
      content: [{ type: 'text', text: `${result.code}: ${result.reason}` }],
      structuredContent: { code: result.code, reason: result.reason },
      isError: true,
    };
  }
  if ('data' in result) {
    return {
      content: [{ type: 'text', text: JSON.stringify(result.data) }],
      structuredContent: result.data,
      isError: false,
    };
  }
  return {
    content: [{ type: 'text', text: `Done. The change is event ${result.syncId}.` }],
    structuredContent: { syncId: result.syncId, input: result.input },
    isError: false,
  };
}

/**
 * Runs a `tools/call` request as the actor of its connection. The call ID
 * comes from the actor and the request ID, so a repeat of the request commits
 * once. A refused call is a result with `isError`, not a JSON-RPC error.
 */
function callTool<R>(
  tools: AgentTools<R>,
  id: RpcId,
  params: unknown,
  headers: Readonly<Record<string, string | undefined>>,
) {
  return Effect.gen(function* () {
    const call = callOf(params);
    if (!call) {
      return failure(id, -32_602, 'tools/call needs the name of a tool.');
    }
    const actors = yield* Actors;
    const actor: Actor = yield* actors.fromHeaders(headers);
    const result = yield* tools.call(call.name, call.input, actor, `${actor.userId}:${String(id)}`);
    return answer(id, toolResultOf(result));
  });
}

/**
 * The MCP endpoint of a server app, at `POST /mcp`. It speaks JSON-RPC 2.0 over
 * one POST and answers with JSON. It lists the tools that `contracts` declare
 * and runs each call through `changes`, as the sync socket does. A notification
 * gets 202 and no body. It takes a request only from an origin that
 * `SYNC_ORIGINS` allows, and only as `application/json`. See
 * docs/contributing/architecture/mcp.md.
 */
export function mcpRoute<R>(
  changes: ReadonlyArray<ServerChange<R>>,
  contracts: ReadonlyArray<Contract>,
): Route<R | EventLog | SyncGroups | Actors> {
  const tools = agentTools(changes, contracts);
  // The endpoint belongs to the sync engine, not to a contract, so it declares itself here.
  const endpoint = route('sync/mcp', {
    method: 'POST',
    path: '/mcp',
    body: 'none',
    says: 'An agent calls a tool of the app, or lists the tools, over JSON-RPC.',
  });
  return defineRoute(endpoint, (request) =>
    Effect.gen(function* () {
      // A page of another site cannot call a tool with the person's
      // cookies: its origin is refused, and a body that is not sent as
      // JSON is refused, which a cross-site form or script cannot send
      // without a preflight.
      if (!originAllowed(request.headers.origin, yield* syncOrigins)) {
        return HttpServerResponse.text('This origin may not call the MCP endpoint.', {
          status: 403,
        });
      }
      if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        return failure(null, -32_600, 'Send the request as application/json.', 415);
      }
      const text = yield* request.text;
      const decoded = yield* Effect.try((): unknown => JSON.parse(text)).pipe(Effect.option);
      if (Option.isNone(decoded)) {
        return failure(null, -32_700, 'The body is not JSON.', 400);
      }
      const message = messageOf(decoded.value);
      if (!message) {
        return failure(null, -32_600, 'The request is not a JSON-RPC 2.0 request.', 400);
      }
      const { id } = message;
      if (id === undefined) {
        return HttpServerResponse.empty({ status: 202 });
      }
      switch (message.method) {
        case 'initialize': {
          return answer(id, initializeResult(message.params));
        }
        case 'ping': {
          return answer(id, {});
        }
        case 'tools/list': {
          const listed = tools.list.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
          }));
          return answer(id, { tools: listed });
        }
        case 'tools/call': {
          return yield* callTool(tools, id, message.params, request.headers);
        }
        default: {
          return failure(id, -32_601, `The method ${message.method} is not supported.`);
        }
      }
    }),
  );
}
