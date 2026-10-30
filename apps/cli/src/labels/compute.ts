/** A GitHub label: its name, its color as six hex digits, and its description. */
export type Label = { name: string; color: string; description: string };

/** The prefixes that `clutch labels` owns. The workflow removes a stale label with one of them. */
export const ownedPrefixes = ['kind/', 'area/'] as const;

const kinds: Record<string, string> = {
  feat: 'A new feature. A minor release.',
  fix: 'A bug fix. A patch release.',
  docs: 'Documentation only.',
  refactor: 'A change that keeps the behavior.',
  perf: 'A faster or leaner path.',
  test: 'Tests only.',
  build: 'The build, dependencies or tooling.',
  ci: 'The CI workflows.',
  chore: 'Maintenance with no product change.',
  revert: 'Reverts an earlier change.',
};

/**
 * The label that a person adds when a change is one-way and the owner must
 * approve it. See docs/principles/two-way-doors.md. `risk/one-way-door` is
 * the tier that `clutch risk` gives from paths. This one is the person's call.
 */
const oneWayDoor: Label = {
  name: 'one-way-door',
  color: 'b60205',
  description: 'A person marked this change one-way. The owner approves it before it merges.',
};

/** `kind/<type>` from a conventional title, such as `feat(cli)!: add x`, or nothing. */
export function kindLabel(title: string): Label | undefined {
  const type = /^(\w+)(?:\([^)]*\))?!?:\s/u.exec(title)?.[1];
  if (!type || !Object.hasOwn(kinds, type)) {
    return undefined;
  }
  return { name: `kind/${type}`, color: '1d76db', description: kinds[type] };
}

/** The workspace folders that `package.json` names, such as `apps/*`, as globs for one folder. */
export function workspaceGlobs(manifest: unknown) {
  const workspaces = (manifest as { workspaces?: unknown } | null)?.workspaces;
  const list = Array.isArray(workspaces)
    ? workspaces
    : (workspaces as { packages?: unknown } | undefined)?.packages;
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * The area of one changed file. A file in a workspace package is the area of
 * that package's folder name, such as `area/cli` for `apps/cli/src/main.ts`.
 * Any other file is the area of its top folder without a leading dot, such
 * as `area/docs` or `area/github`. A file at the root is `area/root`.
 */
export function areaOf(file: string, workspaces: Array<string>) {
  const parts = file.split('/');
  for (const glob of workspaces) {
    const depth = glob.split('/').length;
    if (parts.length > depth && new Bun.Glob(glob).match(parts.slice(0, depth).join('/'))) {
      return parts[depth - 1];
    }
  }
  return parts.length === 1 ? 'root' : parts[0].replace(/^\.+/u, '');
}

/** The labels of a change: its kind from the title, and an area for each part it touches. */
export function changeLabels(title: string, files: Array<string>, workspaces: Array<string>) {
  const areas = [...new Set(files.map((file) => areaOf(file, workspaces)))].toSorted();
  const kind = kindLabel(title);
  const apply: Array<Label> = [
    ...(kind ? [kind] : []),
    ...areas.map((area) => ({
      name: `area/${area}`,
      color: 'c5def5',
      description: `Changes ${area === 'root' ? 'files at the repository root' : area}.`,
    })),
  ];
  return { apply, define: [...apply, oneWayDoor] };
}
