import { existsSync } from 'node:fs';
import path from 'node:path';

import { git } from '@/git';
import { isDone } from '@/tickets/change';
import type { TicketStore } from '@/tickets/store';
import { gitBackend } from '@/worktree/git-backend';
import { holds } from '@/worktree/prune';

/** What a removal or a kept worktree writes to the dispatch log. */
type Finished = { kind: 'remove' | 'keep'; ticket: string; phase: string; reason: string };

/** The base that a merged branch is in: `origin/HEAD`, or `main` with no remote. */
async function baseOf(root: string) {
  const remote = await git(root, 'rev-parse', '--abbrev-ref', 'origin/HEAD');
  return remote.ok ? remote.out : 'main';
}

/** The local branches of a ticket: its branch links, the branch of its worktree, and `clutch/<id>-*`. */
async function branchesOf(root: string, id: string, links: Array<string>, own: string | null) {
  const listed = await git(
    root,
    'for-each-ref',
    '--format=%(refname:short)',
    `refs/heads/clutch/${id.toLowerCase()}-*`,
  );
  const named = listed.ok ? listed.out.split('\n').filter(Boolean) : [];
  return [...new Set([...links, ...(own ? [own] : []), ...named])];
}

/**
 * Removes the worktree of each ticket whose phases are all `done`, with its
 * local branches that are merged into the base. The agent ends the last phase
 * from inside the worktree, so the next dispatch from another folder removes
 * it. It keeps a worktree with uncommitted changes, and the one that holds
 * `cwd`. It covers each worktree of the project, wherever it lives, such as
 * one that T3 Code made under `~/.t3/worktrees/`. A ticket whose worktree is
 * gone writes nothing.
 */
export async function removeFinished(input: {
  store: TicketStore;
  projectDir: string;
  cwd: string;
}): Promise<Array<Finished>> {
  const { store, projectDir, cwd } = input;
  const lines: Array<Finished> = [];
  const backend = gitBackend(projectDir);
  let fetched = false;
  for (const id of store.ids()) {
    const { links } = store.ticket(id);
    const folder = links.findLast((link) => link.kind === 'worktree')?.value;
    // The main checkout is never a ticket's to remove.
    const main = folder && path.resolve(folder) === path.resolve(projectDir);
    if (!folder || main || !existsSync(folder) || !isDone(store, id)) {
      continue;
    }
    const at = { ticket: id, phase: 'deploy' };
    const keep = (reason: string) => lines.push({ kind: 'keep', ...at, reason });
    if (holds(folder, cwd)) {
      keep(`${folder} stays: this command runs inside it.`);
      continue;
    }
    const records = await backend.list();
    const record = records.find(
      (candidate) => path.resolve(candidate.path) === path.resolve(folder),
    );
    if (!record) {
      keep(`${folder} stays: it is not a worktree of the project.`);
      continue;
    }
    if (record.dirty) {
      keep(`${folder} stays: it has uncommitted changes.`);
      continue;
    }
    if (!fetched) {
      // The pull requests merged on the host, so the base must be fetched to show it.
      await git(projectDir, 'fetch', '--quiet', 'origin');
      fetched = true;
    }
    const base = await baseOf(projectDir);
    const branches = await branchesOf(
      projectDir,
      id,
      links.filter((link) => link.kind === 'branch').map((link) => link.value),
      record.branch,
    );
    const removed = await backend
      .remove({ path: folder, force: false })
      .catch((error: Error) => error);
    if (removed instanceof Error) {
      keep(`${folder} stays: ${removed.message}`);
      continue;
    }
    const deleted: Array<string> = [];
    for (const branch of branches) {
      const merged = await git(projectDir, 'merge-base', '--is-ancestor', branch, base);
      // `-D`, because a merge commit on the base holds the branch, which `-d` does not check.
      const removedBranch = merged.ok && (await git(projectDir, 'branch', '-D', branch));
      if (removedBranch && removedBranch.ok) {
        deleted.push(branch);
      }
    }
    const gone = deleted.length > 0 ? `, and deleted ${deleted.join(', ')}` : '';
    lines.push({ kind: 'remove', ...at, reason: `Removed ${folder}${gone}.` });
  }
  return lines;
}

/**
 * The check of the Deploy phase: each `pull_request` link of the ticket is
 * merged. Throws, so the command exits 1, when the ticket has no such link or
 * one of them is not merged.
 */
export async function checkMerged(store: TicketStore, id: string, cwd: string) {
  const prs = store
    .ticket(id)
    .links.filter((link) => link.kind === 'pull_request')
    .map((link) => link.value);
  if (prs.length === 0) {
    throw new Error(`${id} has no pull_request link.`);
  }
  const states = await Promise.all(
    prs.map(async (pr) => {
      const proc = Bun.spawn(['gh', 'pr', 'view', pr, '--json', 'state', '--jq', '.state'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { pr, state: code === 0 ? out.trim() : `unknown (${err.trim()})` };
    }),
  );
  const open = states.filter((one) => one.state !== 'MERGED');
  if (open.length > 0) {
    throw new Error(
      `${id} has pull requests that are not merged: ${open.map((one) => `${one.pr} is ${one.state}`).join(', ')}.`,
    );
  }
  return { status: 'ok', merged: prs };
}
