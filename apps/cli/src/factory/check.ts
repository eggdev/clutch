import { checkReferences, sortProblems } from '@/factory/references';
import { readTree } from '@/factory/tree';

/** Reads the factory tree at `root` and returns each problem, with the count of each kind. */
export async function checkFactoryTree(root: string) {
  const tree = await readTree(root);
  checkReferences(tree);
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
