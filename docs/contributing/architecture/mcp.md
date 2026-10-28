# MCP server

The MCP server is a product surface for agents. An agent that acts for a user
calls the same commands as the web app, through tools. Agents are
first-class users, so each tool gets the same care as a screen.

| Question                               | Answer                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| Where does a tool's logic live?        | In the server change of the command that the web app calls. The tool is a thin door |
| Who is acting in a tool call?          | The request context, derived from the source `mcp`                                  |
| Who may call a tool?                   | The access check, with the permission that the tool declares                        |
| What does a failed call return?        | An error result with a code from [API errors](./api-errors.md)                      |
| How does a tool that changes data act? | It follows the [rules for agents](../../users/agents.md)                            |
| How much does a list return?           | A slim index with a limit and a cursor. Details come from a second call             |

<!-- kickoff: The MCP app or package, its transport (for example streamable HTTP), and how an agent signs in (for example OAuth). -->

## Rules

This page applies
[one door for each decision](../../principles/one-door-for-each-decision.md)
to the agent surface.

- **No MCP-only logic.** A tool parses its input, runs the server change of a
  command and formats the result. A rule that a tool needs belongs in the
  package that owns the command, so the web app gets it too.
- **Writes go through the event log.** A tool commits its server change
  through the `EventLog` service, so each client of the organization gets the
  delta.
- **One source for each call.** Each tool call derives its
  [request context](./request-context.md) from the source `mcp`. The credential
  is the token that the agent got at sign-in, and its scopes narrow the call.
- **Each tool declares its permission.** The permission is a required field in
  the tool definition. `'none'` is an explicit value. The handler also calls
  the [access check](./authorization.md) with each resource it loads.
- **Errors use the API codes.** A tool error carries a `code` from
  [API errors](./api-errors.md), so an agent can branch on it. A `5xx` keeps
  its internals out of the result, as on HTTP.
- **Changes follow the agent rules.** A tool that creates, changes, deletes,
  sends or spends declares it in its annotations. Its description tells the
  agent to confirm with the user first, as the
  [rules for agents](../../users/agents.md) require. An action that needs a
  live person never has a tool.
- **Progressive disclosure.** A list or search tool returns IDs, names and the
  few fields an agent needs to choose. A `get_*` tool returns the details. No
  tool returns an unbounded list.

## Design guide

### Where each fact goes

| Place               | What it holds                                                                 |
| ------------------- | ----------------------------------------------------------------------------- |
| Server instructions | Workflows and cross-tool conventions: which tool to call first, how IDs chain |
| Tool description    | What the model needs before the call: meaning, gotchas, an example            |
| Input schema        | Each argument: type, default, valid values, format                            |
| Output schema       | The shape of a successful result                                              |
| Tool response       | What the model needs after the call: results, next steps, error detail        |

- Server instructions never repeat a tool description or a schema.
- A description never lists the arguments again. It names an input only to
  explain a rule between fields.
- A description says what the result means and which tool to call next. It
  never names protocol fields.

### Names and annotations

- Tool names are `snake_case`, a verb and a noun: `list_projects`,
  `get_project`, `create_project`, `update_project`, `delete_project`,
  `search_projects`.
- Use a plural noun for `list_*` and `search_*`, and a singular noun for the
  rest.
- Each tool sets every annotation:

| Annotation        | `true` when                                                  |
| ----------------- | ------------------------------------------------------------ |
| `readOnlyHint`    | The tool changes no data                                     |
| `destructiveHint` | The tool deletes data or makes a change that is hard to undo |
| `idempotentHint`  | A second call with the same input changes nothing more       |
| `openWorldHint`   | The tool calls an outside service                            |

### Schemas and responses

- Each input field has a description that gives its default, its valid values
  and its format, such as RFC 3339 with a time zone.
- Each `limit` has a minimum, a maximum and a default.
- Each tool has an output schema. A test checks each success against it.
- A response holds short markdown text for the model and structured data for
  a program. The text gives context and the next step.
- A paged response holds `items` and `pagination` with `hasMore`,
  `nextCursor`, `itemsReturned` and `limit`. The description says to pass
  `nextCursor` for the next page.

### Errors that tell the agent what to do

An error result says what went wrong, how to fix it, and which tool helps. It
gives the valid values when it can.

```text
not_found: Project "p_42" does not exist in this workspace.
Next: call list_projects to see the projects you can open.
```

A human reads the same text in the agent's reply. So the product needs no
second channel that copies an error for an agent.

### One tool per file

Each tool lives in its own file, with its name, description, permission,
annotations, schemas and handler. One small module imports each tool and
registers it. When a tool grows large, split it into a definition, a handler
and a registration file in one folder.

## Tools

<!-- kickoff: A table: Capability, tools, and whether each tool changes data. One row for each capability that the server exposes. -->

## Add a tool

1. Find the command that the tool calls. If it does not exist, add it to its
   package first, with the `command` generator and its tests.
2. Add a file for the tool. Give it a `snake_case` name from the pattern
   above.
3. Declare the permission, or `'none'`.
4. Set all four annotations.
5. Write the input and output schemas, with a description on each field.
6. Write the description: what the tool does, its gotchas, one example, and
   the next tool to call. For a tool that changes data, add the confirm step.
7. Write the handler: derive the request context from `mcp`, run the server
   change, and return text and structured data.
8. Map each tagged error to its API code and a next step.
9. Register the tool in the registration module.
10. Test it through an MCP client: one success, one denial and one error.
11. Add the tool to the table above. Add a line to the server instructions
    only when it changes a workflow.

## What to read when changing it

<!-- kickoff: The files for the server, the registration module, the server instructions and the tool tests. -->

- [Request context](./request-context.md): the `mcp` source
- [Authorization](./authorization.md): the permission each tool declares
- [API errors](./api-errors.md): the codes that a tool error carries
- [Rules for agents](../../users/agents.md): what an agent does before a change
