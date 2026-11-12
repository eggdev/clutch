import type { CommandDeclaration } from '@repo/sync/contract/command';
import { matches } from '@repo/sync/contract/fields';
import type { Fields, Stamps } from '@repo/sync/contract/fields';
import type { RecordDeclaration } from '@repo/sync/contract/record';
import type { PoolState } from '@repo/sync/types/local-database';
import type { Transaction } from '@repo/sync/types/protocol';

/**
 * The doors of the object pool. A copy is checked where it comes in and
 * nowhere else: a saved copy when the pool loads, a record of a delta from the
 * server, and a command that the app runs. Past a door, the pool trusts the
 * copy. This file holds the checks and the sentences that they report.
 */

/** Receives one plain sentence about a copy that the pool dropped or refused. */
export type Report = (line: string) => void;

/**
 * The records and commands that the pool checks its copies against. The app
 * gives every contract of its build here, so each copy is checked.
 */
export type PoolDeclarations = {
  readonly records: ReadonlyArray<RecordDeclaration>;
  readonly commands: ReadonlyArray<CommandDeclaration>;
};

/** What the pool takes with a default: the stamps of the platform, and the report. */
export type PoolOptions = {
  readonly stamps?: Stamps;
  readonly report?: Report;
};

/** The stamps of a real device: a random ID, and the clock of the device. */
export const deviceStamps: Stamps = {
  newId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

/** The default report: each sentence goes to the console as an error. */
export const consoleReport: Report = (line) => {
  console.error(line);
};

/** The declarations of the records, by model name. */
export function declarationsByName(
  records: ReadonlyArray<RecordDeclaration>,
): Map<string, RecordDeclaration> {
  return new Map(records.map((record) => [record.name, record]));
}

/** Whether a value is a plain object, which a table list or a meta list must be. */
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Door 1, records. A saved copy is whatever the device held, so its outer
 * shape is checked first: a copy with no tables, or with a table that is no
 * list, cannot be read at all. A saved copy with no groups, or with a record
 * whose model no declaration names or that does not fit its declaration,
 * makes every saved record unusable. Returns the sentence that says why, or
 * undefined when the copy fits.
 */
export function savedRecordsMisfit(
  state: Partial<PoolState>,
  declared: ReadonlyMap<string, RecordDeclaration>,
): string | undefined {
  const { tables } = state;
  if (!isObject(tables) || Object.values(tables).some((rows) => !Array.isArray(rows))) {
    return 'The saved copy has another shape than this build reads, so it was dropped, and the pool loads again from the server.';
  }
  if (!isObject(state.meta) || !Array.isArray(state.groups)) {
    return 'The saved copy names no group for its records, so this build cannot read it. Its records were dropped, and the pool loads again from the server.';
  }
  for (const [model, rows] of Object.entries(state.tables ?? {})) {
    for (const row of rows) {
      if (!declared.get(model)?.is(row)) {
        const count = Object.values(state.tables ?? {}).reduce(
          (total, list) => total + list.length,
          0,
        );
        return `The saved copy of ${model} ${row.id} does not fit this build, so ${count} saved ${count === 1 ? 'record was' : 'records were'} dropped and the pool loads again from the server.`;
      }
    }
  }
  return undefined;
}

/**
 * Door 1, commands. A saved transaction whose command no contract declares, or
 * whose input does not fit the fields of its command, is refused. Returns the
 * sentence that names it, or undefined when it fits.
 */
export function savedCommandMisfit(
  transaction: Transaction,
  commands: ReadonlyArray<CommandDeclaration>,
): string | undefined {
  const declared = commands.find((command) => command.name === transaction.command);
  if (!declared) {
    return `The saved command ${transaction.command} is not declared by this build, so it was not sent.`;
  }
  if (!matches(declared.input, transaction.input)) {
    return `The saved input of ${transaction.command} does not fit this build, so the command was not sent.`;
  }
  return undefined;
}

/**
 * Door 3, a command that the app runs, after its stamps are filled. Returns the
 * sentence that refuses the input, or undefined when it fits.
 */
export function runMisfit(
  command: { readonly name: string; readonly input: Fields },
  filled: Readonly<Record<string, unknown>>,
): string | undefined {
  if (!matches(command.input, filled)) {
    return `The input of ${command.name} does not fit its fields, so it was not run.`;
  }
  return undefined;
}

/**
 * Door 2, a record of a delta. A record that does not fit its declaration, or
 * whose model this build does not declare, means this build is older than the
 * server. It is not stored: a record that the pool cannot check would make
 * the whole saved copy unfit at the next start.
 */
export function deltaRecordMisfit(
  declared: ReadonlyMap<string, RecordDeclaration>,
  model: string,
  id: string,
  row: Readonly<Record<string, unknown>>,
): string | undefined {
  const check = declared.get(model);
  if (!check) {
    return `The server sent ${model} ${id}, and this build declares no ${model}. This build is older than the server, so the record was not stored.`;
  }
  if (!check.is(row)) {
    return `The server sent ${model} ${id}, which does not fit this build. This build is older than the server, so the record was not stored.`;
  }
  return undefined;
}
