import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { checkReferences, sortProblems } from '@/factory/references';
import { readTree } from '@/factory/tree';
import { frontmatter } from '@/issues/parse';

export type BenchConfig = { name: string; model: string; harness: string };
export type BenchTask = { name: string; commit: string; issue: string; check: string };

/** A benchmark with each name resolved: the agent's prompt, its setup commands and each harness. */
export type Suite = {
  name: string;
  agent: string;
  prompt: string;
  setup: Array<string>;
  configs: Array<BenchConfig>;
  tasks: Array<BenchTask>;
};

/**
 * Reads `benchmarks/<name>/benchmark.md` from the tree at `treeDir`. The
 * whole tree must pass the check, so each name in the suite points at a file.
 */
export async function loadSuite(treeDir: string, name: string): Promise<Suite> {
  const tree = await readTree(treeDir);
  checkReferences(tree);
  if (tree.problems.length > 0) {
    const lines = sortProblems(tree.problems).map(
      (problem) => `${problem.file}: ${problem.key ? `${problem.key}: ` : ''}${problem.reason}`,
    );
    throw new Error(
      `The factory tree has problems. Run clutch factory --check.\n${lines.join('\n')}`,
    );
  }
  const entry = tree.benchmarks.find((item) => item.name === name);
  if (!entry) {
    const names = tree.benchmarks.map((item) => item.name).join(', ') || 'none';
    throw new Error(`No benchmarks/${name}/benchmark.md. The suites: ${names}.`);
  }
  const data = entry.data as {
    agent: string;
    configs: Array<{ name: string; model: string }>;
    tasks: Array<BenchTask>;
  };
  const agentFile = `agents/${data.agent}/agent.md`;
  const agentText = await readFile(path.join(treeDir, agentFile), 'utf-8');
  const prompt = agentText.slice(frontmatter(agentText)?.end ?? 0).trim();
  const agent = tree.agents.find((item) => item.name === data.agent);
  const runner = tree.runners.find((item) => item.name === agent?.data.runner);
  const setup = (runner?.data.setup as Array<string> | undefined) ?? [];
  const models = (tree.models?.data.models ?? []) as Array<{ id: string; harness: string }>;
  const configs = data.configs.map((config) => ({
    ...config,
    harness: models.find((model) => model.id === config.model)?.harness ?? '',
  }));
  return { name, agent: data.agent, prompt, setup, configs, tasks: data.tasks };
}

/** The items of `list` whose name is in `wanted`, or all of them when `wanted` is empty. */
export function pick<T extends { name: string }>(
  list: Array<T>,
  wanted: Array<string>,
  flag: string,
) {
  for (const item of wanted) {
    if (!list.some((entry) => entry.name === item)) {
      const names = list.map((entry) => entry.name).join(', ');
      throw new Error(`No ${flag.slice(2)} named ${item}. Pass ${flag} with one of: ${names}.`);
    }
  }
  return wanted.length === 0 ? list : list.filter((item) => wanted.includes(item.name));
}
