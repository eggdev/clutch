import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildBinaries } from '@tools/release/binaries';

/**
 * The bootstrap order that apps/cli/README.md gives, in a fresh project with
 * the release binary: `clutch init`, then `clutch sync`. Git reads this
 * clone for github.com/eggdev/clutch, so sync takes the latest release tag
 * and the test stays offline.
 */
const root = path.resolve(import.meta.dir, '../..');

function sh(cmd: Array<string>, cwd: string, env: Record<string, string>) {
  const proc = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdin: 'ignore' });
  return { code: proc.exitCode, out: `${proc.stdout}${proc.stderr}` };
}

test('init then sync finish in a fresh project, and pr and clutch risk run', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'clutch-fresh-'));
  try {
    const [archive] = await buildBinaries(root, path.join(parent, 'dist'), [
      `${process.platform}-${process.arch}`,
    ]);
    const bin = path.join(parent, 'bin');
    await mkdir(bin);
    const upstream = path.join(parent, 'upstream.git');
    const env = {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      XDG_CACHE_HOME: path.join(parent, 'cache'),
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: `url.${upstream}.insteadOf`,
      GIT_CONFIG_VALUE_0: 'https://github.com/eggdev/clutch.git',
      GIT_CONFIG_KEY_1: 'user.name',
      GIT_CONFIG_VALUE_1: 't',
      GIT_CONFIG_KEY_2: 'user.email',
      GIT_CONFIG_VALUE_2: 't@t',
    };
    sh(['tar', '-xzf', archive, '-C', bin], parent, env);
    expect(sh(['git', 'clone', '--quiet', '--bare', root, upstream], parent, env).code).toBe(0);

    // A new project with only a package.json and its formatter, which init needs.
    const dir = path.join(parent, 'shop');
    await mkdir(path.join(dir, 'node_modules/.bin'), { recursive: true });
    await writeFile(path.join(dir, 'package.json'), '{"name":"shop","version":"0.1.0"}\n');
    await writeFile(path.join(dir, '.gitignore'), 'node_modules/\n');
    await symlink(path.join(root, 'node_modules/oxfmt'), path.join(dir, 'node_modules/oxfmt'));
    await symlink('../oxfmt/bin/oxfmt', path.join(dir, 'node_modules/.bin/oxfmt'));
    const git = (...args: Array<string>) => sh(['git', ...args], dir, env);
    git('init', '--quiet', '--initial-branch=main');
    git('add', '--all');
    git('commit', '--quiet', '--message', 'Start');

    const init = sh(['clutch', 'init', '--yes'], dir, env);
    expect(init.code).toBe(0);
    expect(init.out).toContain('.clutch/risk.yaml');
    // The insteadOf rewrite hides the real name, so name the template as a project would.
    const config = await readFile(path.join(dir, 'clutch.yaml'), 'utf-8');
    await writeFile(
      path.join(dir, 'clutch.yaml'),
      config.replace(/repo: .*/u, 'repo: eggdev/clutch'),
    );
    git('add', '--all');
    git('commit', '--quiet', '--message', 'Adopt Clutch');

    // Sync merges .claude/settings.json, which the formatter ignores, and adds .codex/.
    const sync = sh(['clutch', 'sync'], dir, env);
    expect(sync).toMatchObject({ code: 0 });
    const { scripts } = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf-8'));
    expect(Object.keys(scripts)).toEqual(expect.arrayContaining(['pr', 'clutch', 'validate']));
    git('add', '--all');
    git('commit', '--quiet', '--message', 'Sync');

    expect(sh(['bun', 'run', 'pr', '--help'], dir, env).code).toBe(0);
    git('switch', '--quiet', '--create', 'change');
    await writeFile(path.join(dir, 'notes.md'), 'x\n');
    git('add', '--all');
    git('commit', '--quiet', '--message', 'Notes');
    const risk = sh(['bun', 'run', '--silent', 'clutch', 'risk', '--base', 'main'], dir, env);
    expect(risk).toMatchObject({ code: 0 });
    expect(risk.out).toStartWith('risk/');
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}, 60_000);
