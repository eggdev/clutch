import path from 'node:path';
import { parseArgs } from 'node:util';

import { git } from '@/git';

/**
 * `clutch checks --changed`: the fast check of only what the change affects.
 * It runs the project's own `tools/validate.ts --changed`, which Clutch syncs,
 * so a clone and the release binary run the same check.
 */
export async function checksCommand(args: Array<string>, cwd: string): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { changed: { type: 'boolean' }, base: { type: 'string' } },
  });
  if (!values.changed) {
    console.error('clutch checks runs with --changed. For every check, run: bun run validate');
    return 1;
  }
  const top = await git(cwd, 'rev-parse', '--show-toplevel');
  const root = top.ok ? top.out : cwd;
  const script = path.join(root, 'tools/validate.ts');
  if (!(await Bun.file(script).exists())) {
    console.error(`${root} has no tools/validate.ts. Run clutch sync first.`);
    return 1;
  }
  // The release binary is not bun, so run the bun on PATH.
  const bun = Bun.which('bun') ?? 'bun';
  const proc = Bun.spawn(
    [bun, script, '--changed', ...(values.base ? ['--base', values.base] : [])],
    { cwd: root, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
  );
  return proc.exited;
}
