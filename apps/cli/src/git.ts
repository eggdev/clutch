/** Runs git in `cwd`. Returns the exit status and stdout without its trailing newline. */
export async function git(cwd: string, ...args: Array<string>) {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
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
