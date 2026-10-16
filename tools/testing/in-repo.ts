import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Writes the files into a new directory, runs `check` there, and deletes the directory. */
export async function inRepo<T>(
  files: Record<string, string>,
  check: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'repo-check-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(join(root, dirname(name)), { recursive: true });
      await writeFile(join(root, name), content);
    }
    return await check(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
