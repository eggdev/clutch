import { namePattern } from '@/factory/common';
import type { Entry, Problem, Tree } from '@/factory/tree';

/**
 * The rules that read more than one file: each name that points at another
 * file, at most 1 foreman, and labels that can pass and fail. A key that
 * already has a schema problem is skipped, so each mistake is reported once.
 */

const person = new RegExp(namePattern, 'u');
const show = (value: unknown) => JSON.stringify(value);

type Add = (entry: Entry, key: string, reason: string) => void;

function modelIds(tree: Tree) {
  const ids = new Map<string, string>();
  const list = tree.models?.data.models;
  for (const model of Array.isArray(list) ? list : []) {
    const { id, harness } = (model ?? {}) as { id?: unknown; harness?: unknown };
    if (typeof id === 'string' && typeof harness === 'string') {
      ids.set(id, harness);
    }
  }
  return ids;
}

function checkModels(tree: Tree, add: Add) {
  const models = tree.models?.data.models;
  if (!tree.models || !Array.isArray(models)) {
    return;
  }
  const seen = new Set<unknown>();
  for (const [index, model] of models.entries()) {
    const id = (model as { id?: unknown } | null)?.id;
    if (seen.has(id)) {
      add(tree.models, `models[${index}].id`, `${show(id)} is in the list more than once.`);
    }
    seen.add(id);
  }
}

function checkAgents(tree: Tree, models: Map<string, string>, add: Add) {
  const runners = new Set(tree.runners.map((runner) => runner.name));
  let foreman: Entry | undefined;
  for (const agent of tree.agents) {
    const { role, harness, model, runner } = agent.data;
    if (typeof runner === 'string' && !runners.has(runner)) {
      add(agent, 'runner', `No file runners/${runner}.yaml.`);
    }
    if (typeof model === 'string') {
      if (!tree.models) {
        add(agent, 'model', `${show(model)} needs models.yaml, and the tree has none.`);
      } else if (!models.has(model)) {
        add(agent, 'model', `${show(model)} is not an id in models.yaml.`);
      } else if (typeof harness === 'string' && models.get(model) !== harness) {
        add(
          agent,
          'harness',
          `models.yaml runs ${model} with ${models.get(model)}, not ${harness}.`,
        );
      }
    }
    if (role === 'foreman') {
      if (foreman) {
        add(agent, 'role', `${foreman.file} is the foreman too. A tree has at most 1 foreman.`);
      }
      foreman ??= agent;
    }
  }
}

function checkAutomations(tree: Tree, agents: Set<string>, add: Add) {
  for (const automation of tree.automations) {
    const { agent } = automation.data;
    if (typeof agent === 'string' && !agents.has(agent)) {
      add(automation, 'agent', `No folder agents/${agent}/ with an agent.md.`);
    }
  }
}

function checkLabels(scorer: Entry, add: Add) {
  const { labels, passingScore } = scorer.data;
  if (!Array.isArray(labels)) {
    return;
  }
  const items = labels as Array<{ value?: unknown; score?: unknown } | null>;
  const seen = new Set<unknown>();
  for (const [index, label] of items.entries()) {
    if (seen.has(label?.value)) {
      add(
        scorer,
        `labels[${index}].value`,
        `${show(label?.value)} is the value of an earlier label.`,
      );
    }
    seen.add(label?.value);
  }
  const scores = items.map((label) => label?.score).filter((score) => typeof score === 'number');
  if (typeof passingScore !== 'number' || scores.length !== items.length) {
    return;
  }
  if (!scores.some((score) => score >= passingScore)) {
    add(scorer, 'labels', `No label passes. At least 1 label must score ${passingScore} or more.`);
  }
  if (!scores.some((score) => score < passingScore)) {
    add(scorer, 'labels', `No label fails. At least 1 label must score less than ${passingScore}.`);
  }
}

function checkScorers(tree: Tree, agents: Set<string>, models: Map<string, string>, add: Add) {
  for (const scorer of tree.scorers) {
    const { agents: graded, judge } = scorer.data;
    for (const [index, agent] of (Array.isArray(graded) ? graded : []).entries()) {
      if (typeof agent === 'string' && !agents.has(agent)) {
        add(scorer, `agents[${index}]`, `No folder agents/${agent}/ with an agent.md.`);
      }
    }
    if (typeof judge === 'string' && !models.has(judge) && !person.test(judge)) {
      add(
        scorer,
        'judge',
        `${show(judge)} is not an id in models.yaml, or a person's name in lowercase kebab case.`,
      );
    }
    checkLabels(scorer, add);
  }
}

/** Adds a problem to `tree.problems` for each broken rule across files. */
export function checkReferences(tree: Tree) {
  const flagged = new Set(tree.problems.map((problem) => `${problem.file}\0${problem.key}`));
  const add: Add = (entry, key, reason) => {
    if (!flagged.has(`${entry.file}\0${key}`)) {
      tree.problems.push({ file: entry.file, key, reason });
    }
  };
  const agents = new Set(tree.agents.map((agent) => agent.name));
  const models = modelIds(tree);
  checkModels(tree, add);
  checkAgents(tree, models, add);
  checkAutomations(tree, agents, add);
  checkScorers(tree, agents, models, add);
}

/** The problems sorted by file, in the order each file reported them. */
export function sortProblems(problems: Array<Problem>) {
  return problems.toSorted((a, b) => a.file.localeCompare(b.file, 'en'));
}
