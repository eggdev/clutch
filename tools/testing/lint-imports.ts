import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../..');

/** Writes the files into a new directory, lints it, and lists `path rule` for each diagnostic. */
export async function lint(files: Record<string, string>): Promise<Array<string>> {
  const directory = await mkdtemp(path.join(tmpdir(), 'import-rule-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      await mkdir(path.resolve(directory, name, '..'), { recursive: true });
      await writeFile(path.join(directory, name), source);
    }
    const run = Bun.spawnSync([
      path.resolve(root, 'node_modules/.bin/oxlint'),
      '-c',
      path.resolve(root, 'oxlint.config.ts'),
      '--format',
      'json',
      directory,
    ]);
    const result = JSON.parse(run.stdout.toString());
    const lines: Array<string> = result.diagnostics
      .filter((item: { code: string }) => item.code.startsWith('repo-imports('))
      .map(
        (item: { code: string; filename: string }) =>
          `${path.relative(directory, item.filename)} ${item.code.replace(/^repo-imports\((.+)\)$/u, '$1')}`,
      );
    return lines.toSorted();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
