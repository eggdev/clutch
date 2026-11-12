import { builtInRefusals } from '@repo/sync/contract/command';
import type { CommandDeclaration } from '@repo/sync/contract/command';
import type { Contract } from '@repo/sync/contract/define';
import type { InputField } from '@repo/sync/contract/fields';
import type { Load } from '@repo/sync/contract/record';

/**
 * The tools that an app offers to an agent, made from its contracts. A write
 * tool is a command with a `tool` declaration: the same input, the same
 * access rule and the same server change as the screen uses. A read tool is
 * a load function with a `tool` declaration: the records that a client gets
 * when it loads the group, with the same access. Nothing here is written by
 * hand for one tool, so no tool holds logic of its own. See
 * docs/contributing/architecture/mcp.md.
 */

/** The JSON Schema of one input field, as an MCP client reads it. */
export type PropertySchema = {
  readonly type?: string | ReadonlyArray<string>;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly default?: number;
  readonly enum?: ReadonlyArray<string>;
  readonly items?: PropertySchema;
  readonly properties?: Readonly<Record<string, PropertySchema>>;
  readonly required?: ReadonlyArray<string>;
  readonly additionalProperties?: false;
  readonly anyOf?: ReadonlyArray<PropertySchema>;
  readonly description?: string;
};

/** What a tool does when it is called: it runs a command, lists a group or gets one record of it. */
export type ToolTarget =
  | { readonly kind: 'command'; readonly command: string }
  | { readonly kind: 'list'; readonly load: string; readonly fields: ReadonlyArray<string> }
  | { readonly kind: 'get'; readonly load: string };

export type ToolDefinition = {
  /** The tool name in snake case, such as `notes_rename` or `notes_of_space_list`. */
  readonly name: string;
  readonly target: ToolTarget;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, PropertySchema>>;
    readonly required: ReadonlyArray<string>;
    readonly additionalProperties: false;
  };
  /** The four MCP annotations, from the words of the `tool` declaration. */
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: boolean;
  };
  /** Each code with which a call can be refused: the tool's own, then the built-in ones. */
  readonly refusals: ReadonlyArray<string>;
};

/** The most records that one call of a list tool returns, and how many it returns when the caller names no limit. */
export const listLimit = { most: 200, usual: 50 } as const;

/** The tool name of a command or a load function: `notes/rename` is `notes_rename`. */
export function toolName(name: string): string {
  return name.replaceAll(/[/-]/gu, '_');
}

/** A schema that also takes null. A simple type gains `null`; any other schema goes in `anyOf`. */
function orNull(schema: PropertySchema): PropertySchema {
  return typeof schema.type === 'string' && Object.keys(schema).length === 1
    ? { type: [schema.type, 'null'] }
    : { anyOf: [schema, { type: 'null' }] };
}

/** Whether the caller must give a field: each kind but a stamp, an optional kind and `json`. */
function isRequired(kind: InputField): boolean {
  return typeof kind === 'object'
    ? kind.kind !== 'optional'
    : !kind.endsWith('?') && kind !== 'json' && kind !== 'new-id' && kind !== 'now';
}

/** The schema of a kind with a name: a scalar, its `?` form or `json`. */
function plainProperty(kind: string): PropertySchema {
  if (kind === 'json') {
    return {};
  }
  return kind.endsWith('?') ? { type: [kind.slice(0, -1), 'null'] } : { type: kind };
}

/**
 * The schema of one field, or nothing for a field that the caller never
 * gives. The server sets `now`, so a caller cannot choose the time.
 */
function propertyOf(kind: InputField): PropertySchema | undefined {
  if (kind === 'now') {
    return undefined;
  }
  if (kind === 'new-id') {
    return {
      type: 'string',
      description:
        'The ID of the new record. Pass the same ID to repeat the call safely. Leave it out, and the server makes one.',
    };
  }
  if (typeof kind !== 'object') {
    return plainProperty(kind);
  }
  switch (kind.kind) {
    case 'string': {
      return kind.min === undefined
        ? { type: 'string', maxLength: kind.max }
        : { type: 'string', minLength: kind.min, maxLength: kind.max };
    }
    case 'enum': {
      return { type: 'string', enum: kind.values };
    }
    case 'list': {
      return { type: 'array', items: propertyOf(kind.of) ?? {} };
    }
    case 'shape': {
      return {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(kind.fields).map(([name, of]) => [name, propertyOf(of) ?? {}]),
        ),
        required: Object.entries(kind.fields)
          .filter(([, of]) => isRequired(of))
          .map(([name]) => name),
        additionalProperties: false,
      };
    }
    case 'optional': {
      return orNull(propertyOf(kind.of) ?? {});
    }
  }
}

function commandTool(declared: CommandDeclaration): Array<ToolDefinition> {
  const { tool } = declared;
  if (tool === 'none') {
    return [];
  }
  const properties: Record<string, PropertySchema> = {};
  for (const [name, kind] of Object.entries(declared.input)) {
    const property = propertyOf(kind);
    if (property) {
      properties[name] = property;
    }
  }
  return [
    {
      name: toolName(declared.name),
      target: { kind: 'command', command: declared.name },
      description: tool.says,
      inputSchema: {
        type: 'object',
        properties,
        required: Object.entries(declared.input)
          .filter(([, kind]) => isRequired(kind))
          .map(([name]) => name),
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        // MCP reads a change that is not only an addition as destructive.
        destructiveHint: tool.does !== 'adds',
        idempotentHint: tool.idempotent,
        openWorldHint: !tool.closed,
      },
      refusals: [...declared.refuses.toSorted(), ...builtInRefusals],
    },
  ];
}

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * The two read tools of a load function. The list tool gives a slim index
 * with a limit and a cursor, and the get tool gives one whole record, so no
 * call returns a list without a bound.
 */
function readTools(declared: Load): Array<ToolDefinition> {
  const { tool } = declared;
  if (tool === 'none') {
    return [];
  }
  const group = {
    type: 'string',
    description: `The ID of the ${declared.prefix} whose records to read.`,
  };
  const name = toolName(declared.name);
  return [
    {
      name: `${name}_list`,
      target: { kind: 'list', load: declared.name, fields: tool.fields },
      description: `${tool.says} Each item has: ${['id', ...tool.fields.filter((field) => field !== 'id')].join(', ')}. Pass \`nextCursor\` as \`cursor\` for the next page. Call ${name}_get for a whole record.`,
      inputSchema: {
        type: 'object',
        properties: {
          id: group,
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: listLimit.most,
            default: listLimit.usual,
            description: `How many items to return, from 1 to ${listLimit.most}. The default is ${listLimit.usual}.`,
          },
          cursor: { type: 'string', description: 'The `nextCursor` of the page before.' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      annotations: readOnly,
      refusals: [...builtInRefusals],
    },
    {
      name: `${name}_get`,
      target: { kind: 'get', load: declared.name },
      description: `One whole ${declared.record} of a ${declared.prefix}, by its ID. Call ${name}_list to find the ID.`,
      inputSchema: {
        type: 'object',
        properties: {
          id: group,
          record: { type: 'string', description: `The ID of the ${declared.record}.` },
        },
        required: ['id', 'record'],
        additionalProperties: false,
      },
      annotations: readOnly,
      refusals: [...builtInRefusals],
    },
  ];
}

/**
 * The tools of the contracts, sorted by name: one for each command that
 * declares a tool, and two for each load function that declares one.
 */
export function toolsOf(contracts: ReadonlyArray<Contract>): ReadonlyArray<ToolDefinition> {
  return contracts
    .flatMap((contract) => [
      ...contract.commands.flatMap((declared) => commandTool(declared)),
      ...contract.loads.flatMap((declared) => readTools(declared)),
    ])
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
