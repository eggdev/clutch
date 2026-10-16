import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Line budgets for files that agents load on every task. See
 * docs/principles/lean-agent-context.md.
 */
export const budgets: Record<string, number> = { 'AGENTS.md': 20 };

export async function checkFileSize(root: string): Promise<string[]> {
  const errors: string[] = [];
  for (const [file, budget] of Object.entries(budgets)) {
    if (!existsSync(join(root, file))) continue;
    const lines = (await Bun.file(join(root, file)).text()).trimEnd().split('\n').length;
    if (lines > budget)
      errors.push(
        `${file}: ${lines} lines, budget ${budget}. Move detail to the page that owns it.`,
      );
  }
  return errors;
}

if (import.meta.main) {
  const errors = await checkFileSize(process.cwd());
  if (errors.length) {
    console.error(
      [
        `File size check failed (${errors.length}).`,
        'Move detail to the page that owns it. See docs/principles/lean-agent-context.md.',
        '',
        ...errors,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else console.log('Files are within their line budgets.');
}
