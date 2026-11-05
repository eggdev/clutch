import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Gh } from '@/doctor/remote';
import { checkReferences } from '@/factory/references';
import { readTree } from '@/factory/tree';
import { frontmatter } from '@/issues/parse';

/** The settings and prompt of one agent in the factory tree. */
export type Agent = {
  name: string;
  role: string;
  harness: string;
  model: string;
  /** The agent's prompt: the body of its agent.md. */
  body: string;
};

/** The facts of a pull request that a stage reads. */
export type Pull = {
  number: number;
  title: string;
  url: string;
  head: string;
  headRef: string;
  baseRef: string;
  body: string;
};

/**
 * Reads `agents/<name>/agent.md` in the tree at `root`. Fails when the agent
 * is missing, or when the factory check finds a problem in its file or in
 * models.yaml, so a run never starts with a model that the tree does not allow.
 */
export async function loadAgent(root: string, name: string): Promise<Agent> {
  const tree = await readTree(root);
  checkReferences(tree);
  const entry = tree.agents.find((agent) => agent.name === name);
  if (!entry) {
    const names = tree.agents.map((agent) => agent.name).join(', ') || 'none';
    throw new Error(`No agent ${name} in ${root}/agents. Agents: ${names}.`);
  }
  const problems = tree.problems.filter(
    (problem) => problem.file === entry.file || problem.file === 'models.yaml',
  );
  if (problems.length > 0) {
    const lines = problems.map(
      (problem) => `${problem.file}: ${problem.key ? `${problem.key}: ` : ''}${problem.reason}`,
    );
    throw new Error(`${lines.join('\n')}\nRun \`clutch factory --check\` after the fix.`);
  }
  const text = await readFile(path.join(root, entry.file), 'utf-8');
  const block = frontmatter(text);
  return {
    name,
    role: String(entry.data.role),
    harness: String(entry.data.harness),
    model: String(entry.data.model),
    body: text.slice(block?.end ?? 0).trim(),
  };
}

/** The issue file `.clutch/issues/<id>.md` under the project root. */
export async function readIssueFile(project: string, id: string) {
  if (!/^CL-\d{3}[a-z]?$/u.test(id)) {
    throw new Error(`--issue takes an issue id such as CL-314, not ${id}.`);
  }
  const file = path.join('.clutch', 'issues', `${id}.md`);
  try {
    return { file, text: await readFile(path.join(project, file), 'utf-8') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`No issue file ${file}.`, { cause: error });
    }
    throw error;
  }
}

/** Reads pull request `pr` of `repo` with one REST call. */
export async function readPull(gh: Gh, repo: string, pr: number): Promise<Pull> {
  const result = await gh(['api', `repos/${repo}/pulls/${pr}`]);
  if (!result.ok) {
    throw new Error(`gh api: could not read ${repo}#${pr}. ${result.err.trim()}`);
  }
  const data = JSON.parse(result.out) as {
    title?: string;
    html_url?: string;
    body?: string | null;
    head: { sha: string; ref?: string };
    base?: { ref?: string };
  };
  return {
    number: pr,
    title: data.title ?? '',
    url: data.html_url ?? '',
    head: data.head.sha,
    headRef: data.head.ref ?? '',
    baseRef: data.base?.ref ?? '',
    body: data.body ?? '',
  };
}

/**
 * The full prompt of a stage: the agent's body, then its input. The input is
 * the issue file, the pull request, or both. A stage reads nothing else from
 * the lane, so the prompt plus the repository is all that it knows.
 */
export function buildPrompt(
  agent: Agent,
  input: { issue?: { file: string; text: string }; pull?: Pull },
) {
  const parts = [agent.body, '## Your input'];
  if (input.issue) {
    parts.push(`### Issue \`${input.issue.file}\``, input.issue.text.trim());
  }
  if (input.pull) {
    const { pull } = input;
    parts.push(
      `### Pull request #${pull.number}`,
      [
        `- Title: ${pull.title}`,
        `- URL: ${pull.url}`,
        `- Branch: \`${pull.headRef}\` into \`${pull.baseRef}\``,
        `- Head: \`${pull.head}\``,
      ].join('\n'),
      pull.body.trim() || '(The PR has no body.)',
    );
  }
  if (!input.issue && !input.pull) {
    parts.push('No issue and no pull request. Stop, and report that the stage has no input.');
  }
  return `${parts.join('\n\n')}\n`;
}
