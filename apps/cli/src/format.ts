import path from 'node:path';

/** The clone that this CLI runs from. Its formatter and config format what the CLI writes. */
export const cliRoot = path.resolve(import.meta.dir, '../../..');

/**
 * Says whether the CLI runs from a Clutch clone. The release binary does not: it
 * has no template files, registry or formatter of its own.
 */
export const inClone = () => Bun.file(path.join(cliRoot, 'clutch.files.yaml')).exists();

/** The clone's formatter, or the project's when the CLI runs as the release binary. */
async function formatter(root: string) {
  for (const base of [cliRoot, root]) {
    const bin = path.join(base, 'node_modules/.bin/oxfmt');
    if (await Bun.file(bin).exists()) {
      const config = path.join(base, '.oxfmtrc.json');
      return (await Bun.file(config).exists()) ? [bin, '--config', config] : [bin];
    }
  }
  throw new Error(`Could not find oxfmt. Run \`bun install\` in ${root} first.`);
}

async function run(root: string, args: Array<string>, input?: string) {
  const proc = Bun.spawn([...(await formatter(root)), ...args], {
    cwd: root,
    stdin: input === undefined ? 'ignore' : Buffer.from(input),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`Could not format ${args.at(-1)}: ${err}`);
  }
  return out;
}

/**
 * Writes `file` in the template's format, so that the format check passes
 * after a write. A file that the formatter config ignores, such as
 * `.claude/settings.json`, stays as it is.
 */
export async function formatFile(root: string, file: string) {
  await run(root, ['--no-error-on-unmatched-pattern', file]);
}

/** Returns `text` in the format that the template gives the file at `file`. */
export function formatText(root: string, file: string, text: string) {
  return run(root, [`--stdin-filepath=${file}`], text);
}
