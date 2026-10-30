import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const script = path.resolve(import.meta.dir, 'renovate-changeset.mjs');

/** Runs the script under Node.js, as Renovate does, in a folder with a package.json. */
async function run(data: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'renovate-changeset-'));
  await Bun.$`mkdir -p ${root}/.changeset`;
  await writeFile(`${root}/package.json`, JSON.stringify({ name: 'shop' }));
  await writeFile(`${root}/data.txt`, data);
  await Bun.$`node ${script}`
    .cwd(root)
    .env({ ...process.env, RENOVATE_POST_UPGRADE_COMMAND_DATA_FILE: `${root}/data.txt` })
    .quiet();
  return { root, read: (file: string) => readFile(`${root}/${file}`, 'utf-8') };
}

test('a Renovate branch gets a patch changeset named after it, with the PR title', async () => {
  const { read } = await run(
    'renovate/all-minor-patch\nchore(deps): update all non-major dependencies\n',
  );
  expect(await read('.changeset/renovate-all-minor-patch.md')).toBe(
    '---\n"shop": patch\n---\n\nchore(deps): update all non-major dependencies\n',
  );
});

test('an empty title still gives a summary', async () => {
  const { read } = await run('renovate/nx\n');
  expect(await read('.changeset/renovate-nx.md')).toContain('Update dependencies');
});
