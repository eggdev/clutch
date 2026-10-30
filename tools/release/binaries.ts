import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The platforms of the release binary. Each archive name carries the platform,
 * so mise's `github:eggdev/clutch` backend picks the right one.
 */
export const targets = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'] as const;

async function exec(cmd: Array<string>, cwd?: string) {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`Failed: ${cmd.join(' ')}\n${out}${err}`);
  }
}

/** Compiles the CLI for each target into `out`, as `clutch-<target>.tar.gz` with one `clutch` file. */
export async function buildBinaries(
  root: string,
  out: string,
  only: ReadonlyArray<string> = targets,
) {
  await mkdir(out, { recursive: true });
  // The binary has no clone, so it carries Clutch's version and capability registry.
  const built = {
    version: ((await Bun.file(path.join(root, 'package.json')).json()) as { version: string })
      .version,
    registry: await Bun.file(
      path.join(root, 'docs/contributing/capabilities/registry.yaml'),
    ).text(),
  };
  const archives: Array<string> = [];
  for (const target of only) {
    const dir = await mkdtemp(path.join(tmpdir(), `clutch-${target}-`));
    try {
      await exec(
        [
          process.execPath,
          'build',
          '--compile',
          `--target=bun-${target}`,
          '--define',
          `globalThis.CLUTCH_BUILD=${JSON.stringify(built)}`,
          path.join(root, 'apps/cli/src/main.ts'),
          '--outfile',
          path.join(dir, 'clutch'),
        ],
        root,
      );
      const archive = path.join(out, `clutch-${target}.tar.gz`);
      await exec(['tar', '-czf', archive, '-C', dir, 'clutch']);
      archives.push(archive);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return archives;
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) {
    console.error('Usage: bun tools/release/binaries.ts <out dir> [target...]');
    process.exit(1);
  }
  const only = process.argv.slice(3);
  for (const archive of await buildBinaries(process.cwd(), out, only.length ? only : targets)) {
    console.log(archive);
  }
}
