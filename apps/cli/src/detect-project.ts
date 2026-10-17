import path from 'node:path';

import { git, gitOrThrow } from '@apps/cli/src/git';

export type Detection =
  | { kind: 'existing'; root: string; name: string; defaultBranch: string }
  | { kind: 'refused'; reason: string };

/** The remote's HEAD when there is one, then `main` or `master`, then the current branch. */
async function findDefaultBranch(root: string) {
  const remote = await git(root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  if (remote.ok) {
    return remote.out.replace(/^origin\//u, '');
  }
  for (const name of ['main', 'master']) {
    const local = await git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`);
    if (local.ok) {
      return name;
    }
  }
  return gitOrThrow(root, 'branch', '--show-current');
}

/** Decides if `dir` is a project that the template can install into. */
export async function detectProject(dir: string): Promise<Detection> {
  const top = await git(dir, 'rev-parse', '--show-toplevel');
  if (!top.ok) {
    return {
      kind: 'refused',
      reason: `${dir} is not a git repository. Run \`git init\` and commit, then run this again.`,
    };
  }
  const root = top.out;
  const status = await gitOrThrow(root, 'status', '--porcelain');
  if (status) {
    return {
      kind: 'refused',
      reason: `${root} has uncommitted changes. Commit or stash them, then run this again:\n${status}`,
    };
  }
  const manifests = await git(root, 'ls-files', '--', 'package.json', '**/package.json');
  if (!manifests.out) {
    return {
      kind: 'refused',
      reason: `${root} has no package.json. The template supports JavaScript and TypeScript projects, alone or next to other languages.`,
    };
  }
  const defaultBranch = await findDefaultBranch(root);
  return { kind: 'existing', root, name: path.basename(root), defaultBranch };
}
