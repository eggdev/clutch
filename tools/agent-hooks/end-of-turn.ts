import path from 'node:path';

import { run, tail } from '@tools/agent-hooks/payload';
import type { Outcome, Payload, Run } from '@tools/agent-hooks/payload';

/**
 * At the end of a turn, run the fast checks when the working tree has
 * changes: typecheck and lint for the affected projects, then the repository
 * checks. Silent on success. On a failure, exit 2 with a short summary, so
 * the agent keeps working. A turn that a stop hook already continued is let
 * through, so the hook never loops.
 */
export function endOfTurn(payload: Payload, root: string, runner: Run = run): Outcome {
  if (payload.stop_hook_active) {
    return { exitCode: 0 };
  }
  const status = runner(['git', 'status', '--porcelain'], root);
  if (status.exitCode === 0 && !status.output.trim()) {
    return { exitCode: 0 };
  }
  const mergeBase = runner(['git', 'merge-base', 'HEAD', 'origin/HEAD'], root);
  const base = mergeBase.exitCode === 0 ? mergeBase.output.trim() : 'HEAD';
  const nx = path.join(root, 'node_modules/.bin/nx');
  const env = { CI: '1', NX_TUI: 'false' };
  const steps = [
    [nx, 'affected', '-t', 'typecheck', 'lint', `--base=${base}`, '--outputStyle=static'],
    [nx, 'run-many', '-t', 'checks', '--outputStyle=static'],
  ];
  for (const command of steps) {
    const result = runner(command, root, env);
    if (result.exitCode !== 0) {
      return {
        exitCode: 2,
        stderr: [
          'The checks failed after your edits. Fix them before you end the turn.',
          `Command: ${command.slice(1).join(' ')}`,
          'Run `mise exec -- bun run validate` to see every check.',
          '',
          tail(result.output, 40),
          '',
        ].join('\n'),
      };
    }
  }
  return { exitCode: 0 };
}
