import { existsSync } from 'node:fs';
import path from 'node:path';

import { editedFiles, run, tail } from '@tools/agent-hooks/payload';
import type { Outcome, Payload, Run } from '@tools/agent-hooks/payload';

const lintable = /\.[cm]?[jt]sx?$/u;
const styles = /\.css$/u;

/**
 * After an edit, lint the edited files only, so the agent sees a problem
 * before its next edit. Silent on success. On a problem, exit 2: Claude Code
 * and Codex both show stderr to the agent after the tool ran.
 */
export function afterEdit(payload: Payload, root: string, runner: Run = run): Outcome {
  const files = editedFiles(payload, root).filter(
    (file) => !file.split('/').includes('node_modules') && existsSync(path.join(root, file)),
  );
  const problems: Array<string> = [];
  const code = files.filter((file) => lintable.test(file));
  if (code.length) {
    const result = runner([path.join(root, 'node_modules/.bin/oxlint'), ...code], root);
    if (result.exitCode !== 0) {
      problems.push(result.output);
    }
  }
  const css = files.filter((file) => styles.test(file));
  if (css.length) {
    const result = runner([path.join(root, 'node_modules/.bin/stylelint'), ...css], root);
    if (result.exitCode !== 0) {
      problems.push(result.output);
    }
  }
  if (!problems.length) {
    return { exitCode: 0 };
  }
  return {
    exitCode: 2,
    stderr: [
      'Lint found problems in the file you edited. Fix them before your next edit.',
      'Each message names the fix and the page that owns the rule.',
      '',
      tail(problems.join('\n'), 60),
      '',
    ].join('\n'),
  };
}
