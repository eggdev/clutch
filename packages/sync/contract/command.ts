import { matches } from '@repo/sync/contract/fields';
import type { Fields, TypeOf } from '@repo/sync/contract/fields';
import type { Model, RecordRow } from '@repo/sync/contract/record';

/** The writable view of the object pool that only a command's local change receives. */
export type Draft = {
  readonly get: <Row extends RecordRow>(model: Model<Row>, id: string) => Row | undefined;
  readonly put: <Row extends RecordRow>(model: Model<Row>, row: Row) => void;
  readonly remove: <Row extends RecordRow>(model: Model<Row>, id: string) => void;
};

/**
 * What a command offers to a caller that is not the person: an agent, or the
 * system. The words follow the tool annotations of MCP. A command that only a
 * live person may run says `'none'`.
 */
export type Tool = {
  /** What it does to what the person keeps: it adds, it changes, or it removes. */
  readonly does: 'adds' | 'changes' | 'removes';
  /** Whether a second call with the same input changes nothing more. */
  readonly idempotent: boolean;
  /** Whether it touches only the product's own data. A tool that reaches an outside service is open. */
  readonly closed: boolean;
  /** What the caller reads before it calls the tool. */
  readonly says: string;
};

/** Whether the screen shows a command at once, or after the server confirms it. */
export type Waits = 'local' | 'server';

/**
 * Who may run a command. `'organization'` lets any actor of the organization
 * run it. `'group'` asks the server half for the sync group of the record
 * that the command writes, and the actor must be allowed that group.
 */
export type Access = 'organization' | 'group';

/** The codes with which any command can be refused, before or around its own rules. */
export const builtInRefusals = [
  'invalid-input',
  'not-found',
  'forbidden',
  'unknown-command',
  'failed',
] as const;
export type BuiltInRefusal = (typeof builtInRefusals)[number];

/**
 * One command, as a contract declares it: its name, the fields of its input,
 * whether it waits for the server, who may run it, the codes with which its
 * server half may refuse it, and what it offers as a tool. This is data. The
 * local change and the server change are code, in `commands/`.
 */
export type CommandDeclaration<
  Name extends string = string,
  F extends Fields = Fields,
  W extends Waits = Waits,
  A extends Access = Access,
  Refusal extends string = string,
> = {
  readonly kind: 'command';
  readonly name: Name;
  readonly input: F;
  readonly waits: W;
  readonly access: A;
  /**
   * The permission that the actor's role must grant on the group of the
   * command, such as `project:publish`. A command with none leaves it out,
   * and then the access rule alone decides.
   */
  readonly permission?: string;
  readonly refuses: ReadonlyArray<Refusal>;
  readonly tool: Tool | 'none';
};

const commandName = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/u;
const refusalCode = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

/**
 * Declares one command. No field has a default: each command says whether it
 * waits, who may run it, how it can be refused and what it offers as a tool.
 * The name is `<contract>/<command>`, such as `notes/rename`.
 */
export function command<
  const Name extends string,
  const F extends Fields,
  const W extends Waits,
  const A extends Access,
  const Refusal extends string,
>(
  name: Name,
  definition: {
    readonly input: F;
    readonly waits: W;
    readonly access: A;
    readonly permission?: string;
    readonly refuses: ReadonlyArray<Refusal>;
    readonly tool: Tool | 'none';
  },
): CommandDeclaration<Name, F, W, A, Refusal> {
  if (!commandName.test(name)) {
    throw new Error(
      `The command name "${name}" is not \`<contract>/<command>\` in kebab case, such as \`notes/rename\`.`,
    );
  }
  for (const code of definition.refuses) {
    if (!refusalCode.test(code)) {
      throw new Error(
        `The refusal code "${code}" of ${name} is not kebab case, such as \`name-taken\`.`,
      );
    }
    if (builtInRefusals.some((builtIn) => builtIn === code)) {
      throw new Error(
        `The command ${name} declares the refusal "${code}", which every command already has. Remove it from \`refuses\`.`,
      );
    }
  }
  return { kind: 'command', name, ...definition };
}

/**
 * What the object pool needs to run a transaction again. The pool checks each
 * input when it enters, so `replay` gets an input that fits the fields of its
 * command. The check in `localChange` only narrows the type.
 */
export type Replayable<Name extends string = string> = {
  readonly name: Name;
  readonly replay: (draft: Draft, input: unknown) => void;
};

/**
 * Defines the local change of a command that shows at once. It runs on the
 * object pool in the frame of the user action, and again on top of each
 * delta, so it reads only the draft and its input. The server half is
 * `<name>.server.ts`, next to it.
 */
export function localChange<const Name extends string, const F extends Fields>(
  declared: { readonly name: Name; readonly input: F; readonly waits: 'local' },
  change: (draft: Draft, input: TypeOf<F>) => void,
): Replayable<Name> {
  return {
    name: declared.name,
    replay(draft, input) {
      if (!matches(declared.input, input)) {
        throw new Error(
          `The input of ${declared.name} does not fit its fields. The object pool checks each input before it replays it, so this is a bug in the pool.`,
        );
      }
      change(draft, input);
    },
  };
}
