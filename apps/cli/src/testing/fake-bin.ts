import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Makes a folder of stand-in executables for vendor CLIs, such as `claude`.
 * Each one appends its folder and arguments as a JSON line to `calls.jsonl`,
 * then exits with `exitCode`.
 */
export async function fakeBin(names: Array<string>, options: { exitCode?: number } = {}) {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'cli-bin-')));
  const log = path.join(dir, 'calls.jsonl');
  for (const name of names) {
    const script = [
      `#!${process.execPath}`,
      `const line = JSON.stringify({ name: ${JSON.stringify(name)}, cwd: process.cwd(), args: process.argv.slice(2), tty: process.stdin.isTTY ?? false });`,
      `require('node:fs').appendFileSync(${JSON.stringify(log)}, line + '\\n');`,
      `process.exit(${options.exitCode ?? 0});`,
    ].join('\n');
    await writeFile(path.join(dir, name), script);
    await chmod(path.join(dir, name), 0o755);
  }
  return {
    dir,
    calls: async () => {
      const file = Bun.file(log);
      if (!(await file.exists())) {
        return [];
      }
      const text = await file.text();
      return text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { name: string; cwd: string; args: Array<string> });
    },
    [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }),
  };
}
