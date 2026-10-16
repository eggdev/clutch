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
  for await (const file of new Bun.Glob(sources).scan({ cwd: root })) {
    if (file.split('/').includes('node_modules')) {
      continue;
    }
    const lines = await countLines(path.join(root, file));
    const entry = files[file];
    if (entry) {
      seen.add(file);
    }
    if (entry && !entry.reason?.trim()) {
      errors.push(`${file}: the budget entry has no reason. Say why the file stays deep.`);
    }
    if (entry && lines <= limit) {
      errors.push(
        `${file}: ${lines} lines is within the limit of ${limit}. Delete its budget entry.`,
      );
    } else if (entry && lines > entry.lines) {
      errors.push(
        `${file}: ${lines} lines, budget ${entry.lines}. Split the file, or raise the budget and update its reason in the same change.`,
      );
    } else if (!entry && lines > limit) {
      errors.push(
        `${file}: ${lines} lines, limit ${limit}. Split the file, or add an entry with a reason to tools/file-size-budgets.json.`,
      );
    }
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
