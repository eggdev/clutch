import type { CommandDeclaration, Tool } from '@repo/sync/contract/command';
import type { Contract } from '@repo/sync/contract/define';
import type { InputField } from '@repo/sync/contract/fields';
import type { GroupRef } from '@repo/sync/contract/groups';
import type { RouteDeclaration } from '@repo/sync/contract/route';

/**
 * The manifest: every record, command and load function of the contracts of
 * an app, as plain sorted JSON. It is what the app offers on the wire. Two
 * builds with the same manifest speak the same protocol, so its digest names
 * a build to the server, and a diff of two manifests says which changes an
 * installed build survives.
 */

/**
 * One field kind as the manifest writes it: a scalar or a stamp as its name,
 * and each other kind as an object with its parts in one fixed order.
 */
export type ManifestKind =
  | string
  | { readonly kind: 'string'; readonly min: number; readonly max: number }
  | { readonly kind: 'enum'; readonly values: ReadonlyArray<string> }
  | { readonly kind: 'list'; readonly of: ManifestKind }
  | { readonly kind: 'shape'; readonly fields: Readonly<Record<string, ManifestKind>> }
  | { readonly kind: 'optional'; readonly of: ManifestKind };

export type ManifestRecord = {
  readonly name: string;
  readonly contract: string;
  readonly fields: Readonly<Record<string, ManifestKind>>;
  readonly groups: ReadonlyArray<string>;
};

export type ManifestCommand = {
  readonly name: string;
  readonly contract: string;
  readonly input: Readonly<Record<string, ManifestKind>>;
  readonly waits: string;
  readonly access: string;
  /** The permission that the command needs on its group, or `null` for none. */
  readonly permission: string | null;
  readonly refuses: ReadonlyArray<string>;
  readonly tool: Tool | 'none';
};

export type ManifestLoad = {
  readonly name: string;
  readonly contract: string;
  readonly record: string;
  readonly group: string;
  /** What the load function offers to an agent as a read tool, or `'none'`. */
  readonly tool: { readonly says: string; readonly fields: ReadonlyArray<string> } | 'none';
};

/** A job as the manifest lists it: its payload fields, which a queued job holds. */
export type ManifestJob = {
  readonly name: string;
  readonly contract: string;
  readonly payload: Readonly<Record<string, ManifestKind>>;
};

/** An HTTP route as the manifest lists it. `body` is `'none'` for a route that reads no body. */
export type ManifestRoute = {
  readonly name: string;
  readonly contract: string;
  readonly method: string;
  readonly path: string;
  readonly body: Readonly<Record<string, ManifestKind>> | 'none';
  readonly says: string;
};

/**
 * The manifest. Its `digest` covers only the records, commands and load
 * functions. A client sends the digest and never calls a job or a route, so
 * a change to `jobs` or `routes` leaves the digest as it was.
 */
export type Manifest = {
  readonly version: 1;
  readonly digest: string;
  readonly records: ReadonlyArray<ManifestRecord>;
  readonly commands: ReadonlyArray<ManifestCommand>;
  readonly loads: ReadonlyArray<ManifestLoad>;
  readonly jobs: ReadonlyArray<ManifestJob>;
  readonly routes: ReadonlyArray<ManifestRoute>;
};

/** One kind in its manifest form, so two ways to write one kind give the same manifest. */
function kindOf(kind: InputField): ManifestKind {
  if (typeof kind !== 'object') {
    return kind;
  }
  switch (kind.kind) {
    case 'string': {
      return { kind: 'string', min: kind.min ?? 0, max: kind.max };
    }
    case 'enum': {
      return { kind: 'enum', values: kind.values.toSorted() };
    }
    case 'list': {
      return { kind: 'list', of: kindOf(kind.of) };
    }
    case 'shape': {
      return {
        kind: 'shape',
        fields: Object.fromEntries(
          Object.entries(kind.fields)
            .map(([name, of]) => [name, kindOf(of)] as const)
            .toSorted(([a], [b]) => a.localeCompare(b)),
        ),
      };
    }
    case 'optional': {
      return { kind: 'optional', of: kindOf(kind.of) };
    }
  }
}

/** The fields of a record or an input, with their names in order. */
function fieldsOf(fields: Readonly<Record<string, InputField>>): Record<string, ManifestKind> {
  return Object.fromEntries(
    Object.entries(fields)
      .map(([name, kind]) => [name, kindOf(kind)] as const)
      .toSorted(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * One group of a record as the manifest writes it, such as `space:{spaceId}`,
 * or `shared:{projectId} unless status is draft|ready` for a group with a condition.
 */
function groupText(ref: GroupRef): string {
  const group = `${ref.prefix}:{${'field' in ref ? ref.field : ref.scope}}`;
  const condition = ref.when;
  return condition
    ? `${group} ${condition.not ? 'unless' : 'when'} ${condition.field} is ${condition.values.map(String).toSorted().join('|')}`
    : group;
}

/** The body of a route as the manifest writes it: its fields, or `'none'`. */
function bodyManifest(body: RouteDeclaration['body']): ManifestRoute['body'] {
  return body === 'none' ? 'none' : fieldsOf(body);
}

function commandEntry(contract: string, declared: CommandDeclaration): ManifestCommand {
  return {
    name: declared.name,
    contract,
    input: fieldsOf(declared.input),
    waits: declared.waits,
    access: declared.access,
    permission: declared.permission ?? null,
    refuses: declared.refuses.toSorted(),
    tool: declared.tool,
  };
}

const byName = (a: { readonly name: string }, b: { readonly name: string }) =>
  a.name.localeCompare(b.name);

/** The first name that two entries share, if any. */
function repeated(entries: ReadonlyArray<{ readonly name: string }>): string | undefined {
  return entries.find(
    (entry, index) => entries.findIndex((other) => other.name === entry.name) !== index,
  )?.name;
}

/**
 * A short, stable name for a text: two 32-bit FNV-1a hashes, as 16 hex
 * characters. It is plain arithmetic, so a browser, a phone and the server
 * give the same digest. It names a manifest. It is not a security check.
 */
export function digestOf(text: string): string {
  const half = (seed: number) => {
    let hash = seed;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.codePointAt(index) ?? 0;
      hash = Math.imul(hash, 0x01_00_01_93);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  return `${half(0x81_1c_9d_c5)}${half(0x9e_37_79_b9)}`;
}

/**
 * The manifest of a list of contracts. Each name is sorted, so the same
 * contracts give the same JSON and the same digest in any order. A record, a
 * command or a load function that two contracts both name fails, because a
 * name is one thing on the wire.
 */
export function manifestOf(contracts: ReadonlyArray<Contract>): Manifest {
  const records = contracts
    .flatMap((contract) =>
      contract.records.map((declared) => ({
        name: declared.name,
        contract: contract.name,
        fields: fieldsOf(declared.fields),
        groups: declared.groups.map(groupText).toSorted(),
      })),
    )
    .toSorted(byName);
  const commands = contracts
    .flatMap((contract) =>
      contract.commands.map((declared) => commandEntry(contract.name, declared)),
    )
    .toSorted(byName);
  const loads = contracts
    .flatMap((contract) =>
      contract.loads.map((declared) => ({
        name: declared.name,
        contract: contract.name,
        record: declared.record,
        group: declared.prefix,
        tool: declared.tool,
      })),
    )
    .toSorted(byName);
  const jobs = contracts
    .flatMap((contract) =>
      contract.jobs.map((declared) => ({
        name: declared.name,
        contract: contract.name,
        payload: fieldsOf(declared.payload),
      })),
    )
    .toSorted(byName);
  const routes = contracts
    .flatMap((contract) =>
      contract.routes.map((declared) => ({
        name: declared.name,
        contract: contract.name,
        method: declared.method,
        path: declared.path,
        body: bodyManifest(declared.body),
        says: declared.says,
      })),
    )
    .toSorted(byName);
  const twice =
    repeated(records) ??
    repeated(commands) ??
    repeated(loads) ??
    repeated(jobs) ??
    repeated(routes);
  if (twice) {
    throw new Error(
      `Two contracts declare ${twice}. A name is one thing on the wire, so rename one of them.`,
    );
  }
  // The digest names what a client sends and reads, so jobs and routes stay out of it.
  const body = { records, commands, loads };
  return { version: 1, digest: digestOf(JSON.stringify(body)), ...body, jobs, routes };
}
