import type { ClutchConfig } from '@/clutch-config/schema';
import { checkReads } from '@/factory/reads';
import { checkReferences, sortProblems } from '@/factory/references';
import { readTree } from '@/factory/tree';

/**
 * Reads the factory tree at `root` and returns each problem, with the count of
 * each kind. `project` is the project root, where an agent's `reads` paths start.
 */
export async function checkFactoryTree(root: string, project: string) {
  const tree = await readTree(root);
  checkReferences(tree);
  await checkReads(tree, root, project);
  return {
    counts: {
      agents: tree.agents.length,
      automations: tree.automations.length,
      runners: tree.runners.length,
      scorers: tree.scorers.length,
      benchmarks: tree.benchmarks.length,
      models: tree.models ? 1 : 0,
    },
    problems: sortProblems(tree.problems),
  };
}

/** The tree root from the project root: `factory.root` in clutch.yaml, or `factory`. */
export function factoryTreeRoot(config: ClutchConfig | undefined) {
  return config?.factory?.root ?? 'factory';
}
