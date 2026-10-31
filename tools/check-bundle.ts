import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/**
 * The first screen of the web app: the entry chunk and the chunks it imports
 * statically. Its JavaScript stays under 150 kB compressed, and it holds no
 * Effect code, which loads after the first paint. See
 * docs/contributing/architecture/client-performance.md.
 */
export const budget = 150_000;
/** Effect marks its runtime values with this prefix, so first-screen Effect code shows it. */
const effectMarker = '~effect/';
const app = 'apps/web';

type Chunk = {
  readonly file: string;
  readonly isEntry?: boolean;
  readonly imports?: ReadonlyArray<string>;
};
export type Manifest = Readonly<Record<string, Chunk>>;

/** The JavaScript files of the first screen: each entry and its static imports. */
export function firstScreen(manifest: Manifest): Array<string> {
  const files = new Set<string>();
  const visit = (key: string) => {
    const chunk = manifest[key];
    if (!chunk || files.has(chunk.file)) {
      return;
    }
    files.add(chunk.file);
    for (const next of chunk.imports ?? []) {
      visit(next);
    }
  };
  for (const [key, chunk] of Object.entries(manifest)) {
    if (chunk.isEntry) {
      visit(key);
    }
  }
  return [...files].filter((file) => file.endsWith('.js')).toSorted();
}

const kB = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;

/** Measures the first screen of a built `dist` folder, and names each problem. */
export async function bundleProblems(
  dist: string,
): Promise<{ problems: Array<string>; gzip: number; brotli: number }> {
  const manifest: Manifest = await Bun.file(path.join(dist, '.vite/manifest.json')).json();
  const problems: Array<string> = [];
  let gzip = 0;
  let brotli = 0;
  for (const file of firstScreen(manifest)) {
    const bytes = new Uint8Array(await Bun.file(path.join(dist, file)).arrayBuffer());
    gzip += gzipSync(bytes, { level: 9 }).length;
    brotli += brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length;
    if (new TextDecoder().decode(bytes).includes(effectMarker)) {
      problems.push(
        `${file}: the first screen holds Effect code. Import Effect and schemas as types only (\`import type\`) in client code, and load Effect code after the first paint.`,
      );
    }
  }
  for (const [name, size] of [
    ['gzip', gzip],
    ['brotli', brotli],
  ] as const) {
    if (size > budget) {
      problems.push(
        `The first screen is ${kB(size)} with ${name}, over the budget of ${kB(budget)}. Move code that the first screen does not need behind a dynamic import.`,
      );
    }
  }
  return { problems, gzip, brotli };
}

/**
 * Builds the web app into a folder of its own, then measures its first screen.
 * `web:build` writes `apps/web/dist` and can run at the same time inside one
 * Nx run, so a shared folder would race.
 */
export async function checkBundle(
  root: string,
): Promise<{ problems: Array<string>; gzip: number; brotli: number }> {
  const out = await mkdtemp(path.join(tmpdir(), 'check-bundle-'));
  try {
    const build = Bun.spawnSync(
      [
        path.join(root, 'node_modules/.bin/vite'),
        'build',
        '--logLevel',
        'error',
        '--outDir',
        out,
        '--emptyOutDir',
      ],
      { cwd: path.join(root, app) },
    );
    if (build.exitCode !== 0) {
      return {
        problems: [`vite build failed in ${app}:\n${build.stderr.toString()}`],
        gzip: 0,
        brotli: 0,
      };
    }
    return await bundleProblems(out);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { problems, gzip, brotli } = await checkBundle(process.cwd());
  if (problems.length) {
    console.error(
      [
        `First-screen bundle check failed (${problems.length}).`,
        'See docs/contributing/architecture/client-performance.md.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log(
      `The first screen of ${app} is ${kB(gzip)} with gzip and ${kB(brotli)} with brotli, with no Effect code.`,
    );
  }
}
