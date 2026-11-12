import { existsSync, readlinkSync } from 'node:fs';
import path from 'node:path';

/** Where xcode-select records the developer folder that the owner of the machine chose. */
const selectedDeveloperLink = '/var/db/xcode_select_link';

/** What `gitProgramOf` reads from the machine. A test gives its own. */
export type GitLookup = {
  readonly platform: string;
  readonly which: (name: string) => string | null;
  readonly developerDir: string | undefined;
  readonly readLink: (file: string) => string | null;
  readonly exists: (file: string) => boolean;
};

/**
 * The git to run. On a Mac with no other git, `git` is a shim in /usr/bin
 * that looks the real program up on each call. That more than doubles the
 * cost of a call, and a command such as a sync makes hundreds. The real
 * program is in the developer folder that xcode-select names, so this finds it
 * once and starts no process to do so. On any other machine, and when the
 * lookup finds nothing, the answer is plain `git`.
 */
export function gitProgramOf(lookup: GitLookup): string {
  if (lookup.platform !== 'darwin' || lookup.which('git') !== '/usr/bin/git') {
    return 'git';
  }
  const folders = [
    lookup.developerDir,
    lookup.readLink(selectedDeveloperLink),
    '/Library/Developer/CommandLineTools',
  ];
  const programs = folders.flatMap((folder) => (folder ? [path.join(folder, 'usr/bin/git')] : []));
  return programs.find((program) => lookup.exists(program)) ?? 'git';
}

function readLink(file: string): string | null {
  try {
    return readlinkSync(file);
  } catch {
    return null;
  }
}

/** The git of this machine, found once for the process. */
export const gitProgram = gitProgramOf({
  platform: process.platform,
  which: (name) => Bun.which(name),
  developerDir: process.env.DEVELOPER_DIR,
  readLink,
  exists: existsSync,
});

/** Runs git in `cwd`. Returns the exit status and stdout without its trailing newline. */
export async function git(cwd: string, ...args: Array<string>) {
  const proc = Bun.spawn([gitProgram, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, out: out.trimEnd(), err: err.trim() };
}

/** Runs git in `cwd` and throws with git's message when it fails. */
export async function gitOrThrow(cwd: string, ...args: Array<string>) {
  const result = await git(cwd, ...args);
  if (!result.ok) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.err}`);
  }
  return result.out;
}
