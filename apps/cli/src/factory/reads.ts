import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { Entry, Tree } from '@/factory/tree';

/**
 * The rule for an agent's `reads`: each path exists in the project, and the
 * prompt links it as a Markdown link. A link resolves from the folder of the
 * agent file, as GitHub renders it, or from the project root when it starts
 * with `/`. A `reads` list that already has a schema problem is skipped.
 */

const scheme = /^[a-z][a-z0-9+.-]*:/iu;
const fence = /^\s*(?:```|~~~)/u;
const inline = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/gu;
const definition = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/u;

/** The link targets in a Markdown body, outside fenced code blocks. */
export function linkTargets(body: string) {
  const targets: Array<string> = [];
  let fenced = false;
  for (const line of body.split('\n')) {
    if (fence.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }
    for (const match of line.matchAll(inline)) {
      targets.push(match[1]);
    }
    const ref = definition.exec(line);
    if (ref) {
      targets.push(ref[1]);
    }
  }
  return targets;
}

const trim = (file: string) => file.replace(/\/+$/u, '');
const posix = (file: string) => file.split(path.sep).join('/');

/** The project paths that `body` links. `dir` is the folder of its file. */
function linkedPaths(body: string, dir: string, project: string) {
  const linked = new Set<string>();
  for (const raw of linkTargets(body)) {
    const target = raw.replace(/[?#].*$/u, '');
    if (!target || scheme.test(target)) {
      continue;
    }
    let decoded = target;
    try {
      decoded = decodeURI(target);
    } catch {
      // Keep the target as written. A bad escape cannot match a path.
    }
    const absolute = decoded.startsWith('/')
      ? path.join(project, decoded)
      : path.resolve(dir, decoded);
    linked.add(trim(posix(path.relative(project, absolute))));
  }
  return linked;
}

async function exists(file: string) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function checkAgent(agent: Entry, root: string, project: string, tree: Tree) {
  const { reads } = agent.data;
  const flagged = tree.problems.some(
    (problem) => problem.file === agent.file && /^reads(?:$|\[)/u.test(problem.key),
  );
  if (!Array.isArray(reads) || flagged) {
    return;
  }
  const dir = path.dirname(path.join(root, agent.file));
  const linked = linkedPaths(agent.body, dir, project);
  for (const [index, read] of (reads as Array<string>).entries()) {
    const key = `reads[${index}]`;
    const shown = JSON.stringify(read);
    if (!(await exists(path.join(project, read)))) {
      tree.problems.push({
        file: agent.file,
        key,
        reason: `${shown} does not exist at the project root.`,
      });
    } else if (!linked.has(trim(read))) {
      const href = posix(path.relative(dir, path.join(project, read)));
      tree.problems.push({
        file: agent.file,
        key,
        reason: `The prompt has no Markdown link to ${shown}. Add one, such as [\`${read}\`](${href}).`,
      });
    }
  }
}

/** Adds a problem to `tree.problems` for each `reads` path that is missing or that the prompt does not link. */
export async function checkReads(tree: Tree, root: string, project: string) {
  for (const agent of tree.agents) {
    await checkAgent(agent, root, project, tree);
  }
}
