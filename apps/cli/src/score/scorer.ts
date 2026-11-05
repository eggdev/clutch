import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { checkReferences, sortProblems } from '@/factory/references';
import { readTree } from '@/factory/tree';
import { frontmatter } from '@/issues/parse';

export type Label = { value: string; score: number; description: string };

/** A scorer of the factory tree, with the model that judges for it. */
export type Scorer = {
  name: string;
  /** The judge prompt: the body of `scorer.md`. */
  prompt: string;
  labels: Array<Label>;
  passingScore: number;
  samplingRate: number;
  judge: { id: string; harness: string; baseUrl: string };
};

/**
 * Reads the scorer `name` from the tree at `root`. The whole tree must pass
 * the factory check, so the scorer's keys and its judge are known to be good.
 * Throws when the tree has a problem, the scorer is not there, or a person judges.
 */
export async function loadScorer(root: string, name: string): Promise<Scorer> {
  const tree = await readTree(root);
  checkReferences(tree);
  if (tree.problems.length > 0) {
    const lines = sortProblems(tree.problems).map(
      (problem) => `  ${problem.file}: ${problem.key ? `${problem.key}: ` : ''}${problem.reason}`,
    );
    throw new Error(
      `The factory tree at ${root} has ${lines.length} ${lines.length === 1 ? 'problem' : 'problems'}:\n${lines.join('\n')}`,
    );
  }
  const entry = tree.scorers.find((scorer) => scorer.name === name);
  if (!entry) {
    const names = tree.scorers.map((scorer) => scorer.name).join(', ') || 'none';
    throw new Error(`No scorer ${name} at ${root}/scorers/. The scorers: ${names}.`);
  }
  const { judge, labels, passingScore, samplingRate } = entry.data as {
    judge: string;
    labels: Array<Label>;
    passingScore: number;
    samplingRate: number;
  };
  const list = (tree.models?.data.models ?? []) as Array<Record<string, unknown>>;
  const model = list.find((item) => item.id === judge);
  if (!model) {
    throw new Error(
      `The judge of ${name} is ${judge}, a person. clutch score runs only a model from models.yaml.`,
    );
  }
  const baseUrl = model.base_url;
  if (baseUrl === undefined) {
    throw new Error(
      `The judge of ${name} is ${judge}, and its item in models.yaml has no base_url. clutch score sends the prompt to an OpenAI-compatible server at that URL.`,
    );
  }
  const text = await readFile(path.join(root, entry.file), 'utf-8');
  const block = frontmatter(text);
  return {
    name,
    prompt: text.slice(block?.end ?? 0).trim(),
    labels,
    passingScore,
    samplingRate,
    // The check proved that base_url is a URL string.
    judge: { id: judge, harness: String(model.harness), baseUrl: String(baseUrl) },
  };
}
