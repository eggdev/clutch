/**
 * A migration that reached `main` never changes. Migration files live in a
 * folder named `migrations` under apps/ or packages/. This check compares the
 * working tree with a base commit on `main` and rejects a change, rename or
 * deletion of a migration that the base already has. A new migration passes.
 *
 * The base is `MIGRATIONS_BASE` when it is set, as CI does. Otherwise it is the
 * merge base with `origin/main`. A repository with no `origin/main` has nothing
 * on `main` yet, so the check passes. So does the first push to `main`, whose
 * base is the zero commit.
 */
const migration = /^(?:apps|packages)\/(?:.+\/)?migrations\/.+/u;

function git(root: string, ...args: Array<string>): string | null {
  const run = Bun.spawnSync(['git', '-C', root, ...args]);
  return run.exitCode === 0 ? run.stdout.toString().trim() : null;
}

export function findBase(root: string, env?: string): string | null {
  if (env && /^0+$/u.test(env)) {
    return null;
  }
  if (env) {
    const base = git(root, 'rev-parse', '--verify', `${env}^{commit}`);
    if (!base) {
      throw new Error(`MIGRATIONS_BASE is ${env}, which is not a commit here. Fetch it first.`);
    }
    return base;
  }
  if (!git(root, 'rev-parse', '--verify', 'origin/main^{commit}')) {
    return null;
  }
  return git(root, 'merge-base', 'origin/main', 'HEAD');
}

function describe(status: string, after: string | undefined): string {
  if (status.startsWith('D')) {
    return 'is deleted';
  }
  if (status.startsWith('R')) {
    return `is renamed to ${after}`;
  }
  return 'is changed';
}

export function checkMigrations(root: string, base: string | null): Array<string> {
  if (!base) {
    return [];
  }
  const listed = git(root, 'diff', '--name-status', '-M', base);
  if (listed === null) {
    throw new Error(`git diff against ${base} failed.`);
  }
  const errors: Array<string> = [];
  for (const line of listed.split('\n').filter(Boolean)) {
    const [status, before, after] = line.split('\t');
    if (status.startsWith('A') || !migration.test(before)) {
      continue;
    }
    errors.push(`${before} ${describe(status, after)}. It reached main, so it never changes.`);
  }
  return errors;
}

if (import.meta.main) {
  const root = process.cwd();
  const base = findBase(root, process.env.MIGRATIONS_BASE);
  const errors = checkMigrations(root, base);
  if (errors.length > 0) {
    console.error(
      [
        `Migration check failed (${errors.length}).`,
        'Restore the merged migration, and write a new migration that makes the change.',
        '',
        ...errors,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log(
      base ? 'No merged migration changed.' : 'No origin/main yet. No migration has merged.',
    );
  }
}
