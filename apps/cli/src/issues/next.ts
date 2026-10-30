import { phases } from '@/issues/parse';
import type { Issue } from '@/issues/parse';

/** The most draft PRs that may stack on each other, counting the new one. */
const maxStackDepth = 3;

function order(issue: Issue) {
  return phases.indexOf(issue.phase);
}

/**
 * The next issue an agent may start: `todo`, owned by `agent`, with every
 * dependency `done`. Issues come in phase order, then id order. A `later`
 * issue is backlog and never comes next. With `stack`, a dependency in
 * `review` also counts, while the chain of PRs stays within `maxStackDepth`.
 */
export function nextIssue(issues: Array<Issue>, options: { stack?: boolean } = {}) {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  /** How many PRs in `review` this issue's branch would sit on. */
  const depth = (issue: Issue, seen = new Set<string>()): number => {
    if (issue.status !== 'review' || seen.has(issue.id)) {
      return 0;
    }
    seen.add(issue.id);
    const deps = issue.dependsOn.map((id) => byId.get(id)).filter((dep) => dep !== undefined);
    return 1 + Math.max(0, ...deps.map((dep) => depth(dep, seen)));
  };
  const ready = (issue: Issue) => {
    const deps = issue.dependsOn.map((id) => byId.get(id));
    if (deps.some((dep) => dep === undefined)) {
      return false;
    }
    const known = deps as Array<Issue>;
    if (known.every((dep) => dep.status === 'done')) {
      return true;
    }
    return (
      options.stack === true &&
      known.every((dep) => dep.status === 'done' || dep.status === 'review') &&
      1 + Math.max(...known.map((dep) => depth(dep))) <= maxStackDepth
    );
  };
  return issues
    .filter(
      (issue) => issue.phase !== 'later' && issue.status === 'todo' && issue.owner === 'agent',
    )
    .toSorted((a, b) => order(a) - order(b) || a.id.localeCompare(b.id))
    .find(ready);
}
