import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'yaml';

const issuesDir = '.clutch/issues';
export const phases = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'RN', 'RB', 'later'] as const;
export const statuses = ['todo', 'in_progress', 'blocked', 'review', 'done'] as const;

type Phase = (typeof phases)[number];
type Status = (typeof statuses)[number];

export type Issue = {
  id: string;
  title: string;
  phase: Phase;
  status: Status;
  dependsOn: Array<string>;
  pr: string;
  owner: string;
  /** The path of the issue file, relative to the repository root. */
  file: string;
};

export type IssueError = { file: string; field?: string; message: string };

const idPattern = /^CL-\d{3}[a-z]?$/u;
export const ownerPattern = /^[a-z][a-z0-9-]*$/u;
const prPattern = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/u;
function oneOf<T extends string>(values: ReadonlyArray<T>, value: unknown): value is T {
  return typeof value === 'string' && (values as ReadonlyArray<string>).includes(value);
}

const show = (value: unknown) => JSON.stringify(value);

/** One check per frontmatter field. Each returns a problem, or nothing when the value is fine. */
const checks: Record<string, (value: unknown) => string | undefined> = {
  id: (value) =>
    typeof value === 'string' && idPattern.test(value)
      ? undefined
      : `Expected CL- and 3 digits, with an optional letter. Got ${show(value)}.`,
  title: (value) =>
    typeof value === 'string' && value.trim() ? undefined : 'Expected a non-empty string.',
  phase: (value) =>
    oneOf(phases, value) ? undefined : `Expected one of ${phases.join(', ')}. Got ${show(value)}.`,
  status: (value) =>
    oneOf(statuses, value)
      ? undefined
      : `Expected one of ${statuses.join(', ')}. Got ${show(value)}.`,
  depends_on: (value) =>
    Array.isArray(value) && value.every((dep) => typeof dep === 'string' && idPattern.test(dep))
      ? undefined
      : 'Expected a list of issue ids.',
  pr: (value) =>
    typeof value === 'string' && (value === '' || prPattern.test(value))
      ? undefined
      : `Expected a GitHub pull request URL or ''. Got ${show(value)}.`,
  owner: (value) =>
    typeof value === 'string' && ownerPattern.test(value)
      ? undefined
      : `Expected agent, brendan or an agent name. Got ${show(value)}.`,
};

/** The YAML between the leading `---` lines, and where it ends in `text`. */
export function frontmatter(text: string) {
  const match = /^---\n([\s\S]*?\n)---\n/u.exec(text);
  return match ? { yaml: match[1], end: match[0].length } : undefined;
}

function readFrontmatter(text: string): Record<string, unknown> | string {
  const block = frontmatter(text);
  if (!block) {
    return 'The file does not start with a --- frontmatter block.';
  }
  try {
    return parse(block.yaml) ?? {};
  } catch (error) {
    return `The frontmatter is not valid YAML: ${String(error)}`;
  }
}

/** Reads one issue file. `file` is its path from the repository root. */
export function parseIssue(
  file: string,
  text: string,
): { issue?: Issue; errors: Array<IssueError> } {
  const data = readFrontmatter(text);
  if (typeof data === 'string') {
    return { errors: [{ file, message: data }] };
  }
  const errors: Array<IssueError> = [];
  for (const field of Object.keys(data)) {
    if (!(field in checks)) {
      errors.push({ file, field, message: 'Unknown field.' });
    }
  }
  for (const [field, check] of Object.entries(checks)) {
    const problem = field in data ? check(data[field]) : 'Missing field.';
    if (problem) {
      errors.push({ file, field, message: problem });
    }
  }
  if (errors.length === 0 && path.basename(file) !== `${String(data.id)}.md`) {
    errors.push({ file, field: 'id', message: `The file name must be ${String(data.id)}.md.` });
  }
  if (errors.length > 0) {
    return { errors };
  }
  const issue: Issue = {
    id: data.id as string,
    title: (data.title as string).trim(),
    phase: data.phase as Phase,
    status: data.status as Status,
    dependsOn: data.depends_on as Array<string>,
    pr: data.pr as string,
    owner: data.owner as string,
    file,
  };
  return { issue, errors };
}

/** Finds dependencies on missing issues, and dependency cycles. */
export function checkGraph(issues: Array<Issue>): Array<IssueError> {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const errors: Array<IssueError> = [];
  for (const issue of issues) {
    for (const dep of issue.dependsOn) {
      if (!byId.has(dep)) {
        errors.push({ file: issue.file, field: 'depends_on', message: `Unknown issue ${dep}.` });
      }
    }
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, trail: Array<string>) => {
    if (state.get(id) === 'done' || !byId.has(id)) {
      return;
    }
    if (state.get(id) === 'visiting') {
      const cycle = [...trail.slice(trail.indexOf(id)), id];
      const issue = byId.get(id) as Issue;
      errors.push({
        file: issue.file,
        field: 'depends_on',
        message: `Dependency cycle: ${cycle.join(' -> ')}.`,
      });
      return;
    }
    state.set(id, 'visiting');
    for (const dep of (byId.get(id) as Issue).dependsOn) {
      visit(dep, [...trail, id]);
    }
    state.set(id, 'done');
  };
  for (const issue of issues) {
    visit(issue.id, []);
  }
  return errors;
}

/** Reads every issue under `.clutch/issues` in `root`, sorted by id. */
export async function readIssues(root: string) {
  const dir = path.join(root, issuesDir);
  const entries = await readdir(dir);
  const names = entries.filter((name) => name.endsWith('.md')).toSorted();
  const issues: Array<Issue> = [];
  const errors: Array<IssueError> = [];
  const seen = new Map<string, string>();
  for (const name of names) {
    const file = `${issuesDir}/${name}`;
    const result = parseIssue(file, await readFile(path.join(dir, name), 'utf-8'));
    errors.push(...result.errors);
    if (result.issue) {
      const other = seen.get(result.issue.id);
      if (other) {
        errors.push({ file, field: 'id', message: `${result.issue.id} is also used by ${other}.` });
      }
      seen.set(result.issue.id, file);
      issues.push(result.issue);
    }
  }
  issues.sort((a, b) => a.id.localeCompare(b.id));
  return { issues, errors: [...errors, ...checkGraph(issues)] };
}
