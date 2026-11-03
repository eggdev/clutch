import path from 'node:path';

import { withRetry } from '@tools/github/gh-retry';
import type { Run } from '@tools/github/stack';

const root = path.resolve(import.meta.dir, '../..');

/** Runs a command at the repository root and returns its output. */
const runCommand: Run = async (command) => {
  const proc = Bun.spawn(command, { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, out, err };
};

/** The runner that auto-merge's scripts use: `runCommand`, with a `gh` read retried on a transient error. */
export const retrying = withRetry(runCommand);
