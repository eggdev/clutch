import path from 'node:path';

/** The clone that this CLI runs from. Its formatter and config format what the CLI writes. */
export const cliRoot = path.resolve(import.meta.dir, '../../..');

const oxfmt = path.join(cliRoot, 'node_modules/.bin/oxfmt');
const config = path.join(cliRoot, '.oxfmtrc.json');

async function run(args: Array<string>, cwd: string, input?: string) {
  const proc = Bun.spawn([oxfmt, '--config', config, ...args], {
    cwd,
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

/** Writes `file` in the template's format, so that the format check passes after a write. */
export async function formatFile(root: string, file: string) {
  await run([file], root);
}

/** Returns `text` in the format that the template gives the file at `file`. */
export function formatText(root: string, file: string, text: string) {
  return run([`--stdin-filepath=${file}`], root, text);
}
