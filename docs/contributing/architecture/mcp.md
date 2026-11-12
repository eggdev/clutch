# MCP server

The MCP server is a product surface for agents. An agent that acts for a user
calls the same commands as the web app, through tools. Agents are
first-class users, so each tool gets the same care as a screen.

| Question                               | Answer                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where does a tool's logic live?        | In the server change of the command that the web app calls. The tool is a thin door                                                                     |
| Who is acting in a tool call?          | The actor that `Actors` gives for the request headers, as on the sync socket                                                                            |
| Who may call a tool?                   | The `access` rule and the `permission` of the command, checked before its server change runs. A read tool checks the group the way the sync socket does |
| What does a failed call return?        | A result with `isError: true` and a code from the command's refusals or the built-in codes                                                              |
| How does a tool that changes data act? | It follows the [rules for agents](../../users/agents.md)                                                                                                |
| How much does a list return?           | A slim index with a limit and a cursor. A get call returns one whole record                                                                             |

<!-- kickoff: The MCP app or package, its transport (for example streamable HTTP), and how an agent signs in (for example OAuth). -->

## Rules

This page applies
[one door for each decision](../../principles/one-door-for-each-decision.md)
to the agent surface.

- **No MCP-only logic.** A tool has no handler of its own. `agentTools` runs the
  server change of its command or the load of its group, and `mcpRoute` only
  parses the request and formats the answer. A rule that a tool needs belongs in
  the package that owns the command, so the web app gets it too.
- **Writes go through the event log.** A tool call runs the same server change
  as the sync socket. The `EventLog` service commits it, so each client of the
  organization gets the delta. A repeat of the same call ID commits once.
- **The actor comes from the request.** `Actors` reads the actor from the
  request headers, as the sync socket does.
- **Each command sets who may call it.** The `access` field of the command is
  checked before its server change runs. A `permission` on the command must
  also be granted to the actor's role.
- **Errors use the API codes.** A refused call carries a code. The codes are
  the refusals of the command and the built-in codes. The result names the
  code, so an agent can branch on it.
- **Changes follow the agent rules.** A command that changes data declares it
  in its `tool` field, and the annotations follow from that declaration. The
  `says` text tells the agent to confirm with the user first, as the
  [rules for agents](../../users/agents.md) require.
- **An action that needs a live person never has a tool.** Such a command
  declares `tool: 'none'`.
- **Read tools come from load functions.** A load function with a `tool`
  declaration gets two read tools, a list and a get. Each one reads the same
  records as the screen that loads the group. No read tool returns an unbounded
  list.

## How a tool is made

A tool comes from a `tool` declaration. A command with a declaration gets one
write tool. A load function with a declaration gets two read tools. The code
makes the rest of each tool from that declaration.

- `toolsOf` in `packages/sync/contract/tools.ts` makes each tool's name, target,
  description, input schema, annotations and refusal codes. It sorts the tools
  by name.
- `agentTools` in `packages/sync/runtime/tools.server.ts` runs a write through
  the server change of its command. It uses the same input check, access rule
  and event log as the sync socket. It reads a group the same way for a read tool.
- `mcpRoute` in `packages/sync/runtime/mcp.server.ts` serves the tools at
  `POST /mcp`, as JSON-RPC 2.0. The server app wires it in `apps/api/src/server.ts`.
- `mcpRoute` takes a request only from an origin that `SYNC_ORIGINS` allows,
  and only as `application/json`. A page of another site then cannot call a
  tool with the cookies of a person.
  `packages/sync/runtime/mcp.server.test.ts` tests both refusals.

## Read tools

A load function with a `tool` declaration gives two read tools. For
`notes/of-space`, they are `notes_of_space_list` and `notes_of_space_get`.

- `<name>_list` takes `id`, the ID of the group. It returns a page of the records
  of the group. Each item has `id` and the fields that the declaration names, sorted by ID.
- `<name>_list` takes `limit`, from 1 to 200, with 50 as the default. It takes
  `cursor`, the `nextCursor` of the page before. The reply gives `hasMore`,
  `nextCursor`, `itemsReturned` and `limit` in `pagination`.
- `<name>_get` takes `id` and `record`. It returns the whole record, with each field.
- Both tools are read only. Their annotations say `readOnlyHint: true`,
  `destructiveHint: false`, `idempotentHint: true` and `openWorldHint: false`.
- A read follows the access of the sync socket. A group that the actor may not
  load is refused with `forbidden`. A get of an ID that the group does not hold is
  refused with `not-found`.
- A load function with `tool: 'none'` gives no read tool.
- The MCP route gives a read's data as `structuredContent`, and as JSON text.
  The result has `isError: false`.

`packages/sync/runtime/tools.server.test.ts` tests a read through the event log.

## Design guide

### Where each fact goes

| Place               | What it holds                                                                    |
| ------------------- | -------------------------------------------------------------------------------- |
| Server instructions | Workflows and cross-tool conventions. The `instructions` text in `mcp.server.ts` |
| Tool description    | What the model needs before the call. The `says` text of the `tool` declaration  |
| Input schema        | Each argument: type, nullable, length, allowed values and whether it is required |
| Tool response       | What the model needs after the call: a text line and `structuredContent`         |

- Server instructions never repeat a tool description or a schema.
- A description never lists the arguments again. It names an input only to
  explain a rule between fields.
- A description says what the result means and which tool to call next. It
  never names protocol fields.

### Names and annotations

- A tool name comes from its command or its load function. `toolName` replaces
  each `/` and `-` with `_`, so `notes/rename` becomes `notes_rename`. A read
  tool adds `_list` or `_get`.
- Each tool sets every annotation. The declaration sets them:

| Annotation        | Set from                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `readOnlyHint`    | `false` for a write tool, because a command changes data. `true` for a read tool                                                 |
| `destructiveHint` | `true` for a write tool unless `does` is `'adds'`. MCP reads a change beyond an addition as destructive. `false` for a read tool |
| `idempotentHint`  | `idempotent` for a write tool. `true` for a read tool                                                                            |
| `openWorldHint`   | `true` for a write tool unless `closed` is `true`. A tool that reaches an outside service is open                                |

### Schemas and responses

- Each input field becomes one property of the input schema. `string`,
  `number`, `integer`, `boolean`, `array` and `object` set a type.
- A `?` form, or an `optional` kind, also accepts `null`.
- A `text` field sets `maxLength`, and a `min` sets `minLength`.
- A `oneOf` field sets `enum` to its values.
- A `list` field sets `items`. A `shape` field sets `properties`, with `required`
  and `additionalProperties: false`.
- A `new-id` field has a description. A repeat with the same ID is safe, and the
  server makes an ID when the caller leaves it out.
- A `now` field has no property, because the server sets it.
- A field is required unless it is a stamp, an optional kind or `json`.
- The schema allows no other property, so `additionalProperties` is `false`.
- A success gives the sync ID of its event and the input that ran. A refusal
  gives the code and the reason. A read gives its data.

### Errors that tell the agent what to do

A refusal gives a code and a reason. The server change writes the reason with
`refuse`, and the reason says what went wrong and how to fix it. The tool result
is the code, a colon and the reason:

```text
unknown-command: No tool is named cards_hide. List the tools to see each one.
```

A human reads the same text in the agent's reply. So the product needs no
second channel that copies an error for an agent.

### One declaration for each tool

A tool has no file of its own. Its declaration sits on its command or its load
function, in the contract, beside the input fields and the refusals. `toolsOf`
reads each contract and makes the tools, so no tool holds logic of its own.

## Tools

<!-- kickoff: A table: Capability, tools, and whether each tool changes data. One row for each capability that the server exposes. -->

## Add a tool

1. Find the command or the load function that the tool calls. If it does not
   exist, add it to its contract first, with the `command` generator and its tests.
2. Set the `tool` field. For a command, use `'none'` for a command that a live
   person must run. Otherwise give these four words:
   - `does`: `'adds'`, `'changes'` or `'removes'`.
   - `idempotent`: `true` when a second call with the same input changes nothing more.
   - `closed`: `true` when the command touches only the product's own data.
   - `says`: what the agent reads before the call. For a change, it says to confirm with the user first.
     For a load function, give `{ says, fields }`, where `fields` names each field
     that the list returns. Use `'none'` for no read tool.
3. Run `mise exec -- bun tools/check-contract.ts --write`. It updates
   `contract.json`, which lists each tool. Read the diff and commit it.
4. Test the tool. `packages/sync/contract/tools.test.ts` tests the name, the
   target, the input schema and the annotations. `packages/sync/runtime/tools.server.test.ts`
   tests a write and a read through the event log. `packages/sync/runtime/mcp.server.test.ts`
   tests the JSON-RPC answers.

## What to read when changing it

<!-- kickoff: The files for the server, the registration module, the server instructions and the tool tests. -->

- `packages/sync/contract/command.ts` and `record.ts`: the `tool` declarations of a command and a load function
- `packages/sync/contract/tools.ts`: the tool definitions that `toolsOf` makes
- `packages/sync/runtime/tools.server.ts`: the calls that run through the event log, and the reads
- `packages/sync/runtime/mcp.server.ts`: the JSON-RPC route and its server instructions
- [Authorization](./authorization.md): the access check that each call runs
- [API errors](./api-errors.md): the codes that a refusal carries
- [Rules for agents](../../users/agents.md): what an agent does before a change
