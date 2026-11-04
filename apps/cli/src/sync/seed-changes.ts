import { git } from '@/git';
import { localFile } from '@/review-source';
import type { ClutchSource } from '@/sync/source';

/** A project-owned page whose Clutch copy changed in this sync, and where to see the change. */
export type SeedChange = { path: string; see: string };

/** Where to see Clutch's change to `file`: a GitHub compare link, or a git command when the project names no repository. */
function seeLink(
  input: { template: string; repo?: string; from: string; to: string },
  file: string,
) {
  if (input.repo) {
    return `https://github.com/${input.repo}/compare/${input.from}...${input.to}`;
  }
  return `git -C ${input.template} diff ${input.from} ${input.to} -- ${file}`;
}

/** The commit of `release`. A shallow checkout, as the sync workflow makes, may lack the tag, so it is fetched. */
async function releaseCommit(template: string, release: string) {
  const ref = `${release}^{commit}`;
  let found = await git(template, 'rev-parse', '--verify', '--quiet', ref);
  if (!found.ok) {
    const probe = await git(template, 'rev-parse', '--is-shallow-repository');
    const shallow = probe.out === 'true';
    const depth = shallow ? ['--depth=1'] : [];
    const fetched = await git(
      template,
      'fetch',
      '--quiet',
      '--no-tags',
      ...depth,
      'origin',
      `refs/tags/${release}:refs/tags/${release}`,
    );
    if (!fetched.ok) {
      throw new Error(`the tag is not in ${template}, and fetching it failed: ${fetched.err}`);
    }
    found = await git(template, 'rev-parse', '--verify', '--quiet', ref);
  }
  if (!found.ok) {
    throw new Error(`the tag does not name a commit in ${template}`);
  }
  return found.out;
}

/** The seed paths of `seeds` whose blob or mode differs between `base` and `target`. */
async function changedPaths(template: string, base: string, target: string, seeds: Array<string>) {
  const diff = await git(
    template,
    '--literal-pathspecs',
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    base,
    target,
    '--',
    ...seeds,
  );
  if (!diff.ok) {
    throw new Error(diff.err);
  }
  const names = new Set(diff.out.split('\0'));
  return seeds.filter((file) => names.has(file));
}

/**
 * The seed pages whose Clutch copy changed between the project's last release,
 * `from`, and the sync's target. Sync never changes a seed page, so the project
 * ports each change by hand. A page the project deleted is not listed. It is
 * information only: when `from` cannot be read, the note says why and the list is empty.
 */
export async function seedChangesSince(input: {
  root: string;
  template: string;
  from: string | null;
  source: ClutchSource;
  repo?: string;
}): Promise<{ changes: Array<SeedChange>; note: string | null }> {
  const { from, source } = input;
  const seeds = [...source.seed.keys()];
  if (!from || from === source.release || seeds.length === 0) {
    return { changes: [], note: null };
  }
  const to = source.release ?? source.commit;
  const link = { template: input.template, repo: input.repo, from, to };
  try {
    const base = await releaseCommit(input.template, from);
    const changed = await changedPaths(input.template, base, source.commit, seeds);
    const changes: Array<SeedChange> = [];
    for (const file of changed) {
      if (await localFile(input.root, file)) {
        changes.push({ path: file, see: seeLink(link, file) });
      }
    }
    return { changes, note: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      changes: [],
      note: `Could not read Clutch ${from} to list the project pages that Clutch changed: ${message}.`,
    };
  }
}
