import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Line limits. AGENTS.md has a fixed budget, because agents load it on every
 * task (docs/principles/lean-agent-context.md). Source and test files have one
 * limit. A file can pass it only with an entry in tools/file-size-budgets.json
 * that gives a line budget and the reason the file stays deep.
 */
export const fixed: Record<string, number> = { 'AGENTS.md': 20 };
const sources = '{apps,packages,tools}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}';

type Budgets = { limit: number; files: Record<string, { lines: number; reason: string }> };

async function countLines(file: string) {
  const text = await Bun.file(file).text();
  return text.trimEnd().split('\n').length;
}

/** The files that Git ignores, such as build output. None when `root` is not a repository. */
function ignoredByGit(root: string, files: Array<string>): Set<string> {
  const run = Bun.spawnSync(['git', 'check-ignore', '--stdin'], {
    cwd: root,
    stdin: new TextEncoder().encode(files.join('\n')),
  });
  return new Set(run.stdout.toString().split('\n').filter(Boolean));
}

/** The problems with one source file, given its line count and its budget entry. */
function sizeProblems(
  file: string,
  lines: number,
  limit: number,
  entry: { lines: number; reason: string } | undefined,
): Array<string> {
  if (!entry) {
    return lines > limit
      ? [
          `${file}: ${lines} lines, limit ${limit}. Split the file, or add an entry with a reason to tools/file-size-budgets.json.`,
        ]
      : [];
  }
  const problems: Array<string> = [];
  if (!entry.reason?.trim()) {
    problems.push(`${file}: the budget entry has no reason. Say why the file stays deep.`);
  }
  if (lines <= limit) {
    problems.push(
      `${file}: ${lines} lines is within the limit of ${limit}. Delete its budget entry.`,
    );
  } else if (lines > entry.lines) {
    problems.push(
      `${file}: ${lines} lines, budget ${entry.lines}. Split the file, or raise the budget and update its reason in the same change.`,
    );
  }
  return problems;
}

export async function checkFileSize(root: string): Promise<Array<string>> {
  const errors: Array<string> = [];
  for (const [file, budget] of Object.entries(fixed)) {
    if (!existsSync(path.join(root, file))) {
      continue;
    }
    const lines = await countLines(path.join(root, file));
    if (lines > budget) {
      errors.push(
        `${file}: ${lines} lines, budget ${budget}. Move detail to the page that owns it.`,
      );
    }
  }
  const budgetsFile = path.join(root, 'tools/file-size-budgets.json');
  if (!existsSync(budgetsFile)) {
    return errors;
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
      errors.push(`tools/file-size-budgets.json: ${file} does not exist. Delete its entry.`);
    }
  }
  return errors.toSorted();
}

if (import.meta.main) {
  const errors = await checkFileSize(process.cwd());
  if (errors.length) {
    console.error([`File size check failed (${errors.length}).`, '', ...errors].join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Files are within their line limits and budgets.');
  }
}
