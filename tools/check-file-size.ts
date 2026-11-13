import { existsSync } from 'node:fs';
import path from 'node:path';

import { formatFinding, writeFindings } from '@tools/findings';
import type { Finding } from '@tools/findings';

/**
 * Line limits. Each AGENTS.md file, at the root or in a folder, has a fixed
 * budget, because agents load it on every task in its scope
 * (docs/principles/lean-agent-context.md). Source and test files have one
 * limit. A file can pass it only with an entry in tools/file-size-budgets.json
 * that gives a line budget and the reason the file stays deep.
 */
export const agentsFiles = { pattern: '**/AGENTS.md', budget: 20 };
const sources = '{apps,features,packages,tools}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}';

type Budgets = {
  limit: number;
  files: Record<string, { lines: number; reason: string }>;
};

async function countLines(file: string) {
  const text = await Bun.file(file).text();
  return text.trimEnd().split('\n').length;
}

/** The files that Git ignores, such as build output. None when `root` is not a repository. */
export function ignoredByGit(root: string, files: Array<string>): Set<string> {
  const run = Bun.spawnSync(['git', 'check-ignore', '--stdin'], {
    cwd: root,
    stdin: new TextEncoder().encode(files.join('\n')),
  });
  return new Set(run.stdout.toString().split('\n').filter(Boolean));
}

/** The name of the check, which starts the id of each of its findings. */
const check = 'check-file-size';

/** The problems with one source file, given its line count and its budget entry. */
function sizeProblems(
  file: string,
  lines: number,
  limit: number,
  entry: { lines: number; reason: string } | undefined,
): Array<Finding> {
  if (!entry) {
    return lines > limit
      ? [
          {
            id: `${check}/over-limit`,
            file,
            problem: `${lines} lines, limit ${limit}.`,
            fix: 'Split the file, or add an entry with a reason to tools/file-size-budgets.json.',
          },
        ]
      : [];
  }
  const problems: Array<Finding> = [];
  if (!entry.reason?.trim()) {
    problems.push({
      id: `${check}/budget-without-reason`,
      file,
      problem: 'the budget entry has no reason.',
      fix: 'Say why the file stays deep.',
    });
  }
  if (lines <= limit) {
    problems.push({
      id: `${check}/budget-not-needed`,
      file,
      problem: `${lines} lines is within the limit of ${limit}.`,
      fix: 'Delete its budget entry.',
    });
  } else if (lines > entry.lines) {
    problems.push({
      id: `${check}/over-budget`,
      file,
      problem: `${lines} lines, budget ${entry.lines}.`,
      fix: 'Split the file, or raise the budget and update its reason in the same change.',
    });
  }
  return problems;
}

/** The findings, in the order of their text form. */
function sorted(findings: Array<Finding>) {
  const text = new Map(findings.map((finding) => [finding, formatFinding(finding)]));
  return findings.toSorted((a, b) => {
    const [left, right] = [text.get(a) ?? '', text.get(b) ?? ''];
    return left < right ? -1 : Number(left > right);
  });
}

export async function checkFileSize(root: string): Promise<Array<Finding>> {
  const errors: Array<Finding> = [];
  const agents: Array<string> = [];
  for await (const file of new Bun.Glob(agentsFiles.pattern).scan({
    cwd: root,
    dot: true,
  })) {
    if (!file.split('/').includes('node_modules')) {
      agents.push(file);
    }
  }
  const ignoredAgents = ignoredByGit(root, agents);
  for (const file of agents) {
    if (ignoredAgents.has(file)) {
      continue;
    }
    const lines = await countLines(path.join(root, file));
    if (lines > agentsFiles.budget) {
      errors.push({
        id: `${check}/agents-file-over-budget`,
        file,
        problem: `${lines} lines, budget ${agentsFiles.budget}.`,
        fix: 'Move detail to the page that owns it.',
      });
    }
  }
  const budgetsFile = path.join(root, 'tools/file-size-budgets.json');
  if (!existsSync(budgetsFile)) {
    return sorted(errors);
  }
  const { limit, files }: Budgets = await Bun.file(budgetsFile).json();
  const seen = new Set<string>();
  const scanned: Array<string> = [];
  for await (const file of new Bun.Glob(sources).scan({ cwd: root })) {
    if (!file.split('/').includes('node_modules')) {
      scanned.push(file);
    }
  }
  const ignored = ignoredByGit(root, scanned);
  for (const file of scanned) {
    if (ignored.has(file)) {
      continue;
    }
    const entry = files[file];
    if (entry) {
      seen.add(file);
    }
    errors.push(...sizeProblems(file, await countLines(path.join(root, file)), limit, entry));
  }
  for (const file of Object.keys(files)) {
    if (!seen.has(file)) {
      errors.push({
        id: `${check}/budget-for-missing-file`,
        file: 'tools/file-size-budgets.json',
        problem: `${file} does not exist.`,
        fix: 'Delete its entry.',
      });
    }
  }
  return sorted(errors);
}

if (import.meta.main) {
  const root = process.cwd();
  const errors = await checkFileSize(root);
  writeFindings(root, check, errors);
  if (errors.length) {
    console.error(
      [`File size check failed (${errors.length}).`, '', ...errors.map(formatFinding)].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Files are within their line limits and budgets.');
  }
}
