import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Only drizzle-kit writes migrations. For each package with a
 * `drizzle.config.ts`, this check rejects:
 *
 * - a schema change with no migration, from `drizzle-kit check`
 * - an entry in `repo/migrations/` that drizzle-kit did not write: each one is
 *   a `<14-digit timestamp>_<name>/` folder with `migration.sql` and
 *   `snapshot.json`, and nothing else
 *
 * See docs/contributing/setup/migrations.md.
 */
const folderName = /^\d{14}_[a-z0-9_]+$/u;
const generatedFiles = ['migration.sql', 'snapshot.json'];

/** Each `packages/*` folder with a drizzle-kit config. */
export function databasePackages(root: string): Array<string> {
  const packages = path.join(root, 'packages');
  if (!existsSync(packages)) {
    return [];
  }
  return readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}`)
    .filter((folder) => existsSync(path.join(root, folder, 'drizzle.config.ts')))
    .toSorted();
}

/** The entries in one package's migrations folder that drizzle-kit did not write. */
export function layoutProblems(root: string, folder: string): Array<string> {
  const migrations = path.join(root, folder, 'repo', 'migrations');
  if (!existsSync(migrations)) {
    return [`${folder}/repo/migrations/ is missing. Restore it with a \`.gitkeep\`.`];
  }
  const problems: Array<string> = [];
  for (const entry of readdirSync(migrations, { withFileTypes: true })) {
    const where = `${folder}/repo/migrations/${entry.name}`;
    if (entry.name === '.gitkeep') {
      continue;
    }
    if (!entry.isDirectory() || !folderName.test(entry.name)) {
      problems.push(
        `${where}: drizzle-kit did not write this. Delete it, change \`repo/schema.ts\`, and run \`mise exec -- bun nx run @repo/<package>:db-generate\`.`,
      );
      continue;
    }
    const files = readdirSync(path.join(migrations, entry.name)).toSorted();
    if (files.join(',') !== generatedFiles.join(',')) {
      problems.push(
        `${where}: holds ${files.join(', ') || 'nothing'}, but drizzle-kit writes only ${generatedFiles.join(' and ')}. Restore the folder from main, or generate a new migration.`,
      );
    }
  }
  return problems;
}

type CheckOutput = {
  status?: string;
  warnings?: Array<{ kind?: string; message?: string }>;
  errors?: Array<{ message?: string }>;
};

/** What `drizzle-kit check` says about one package, as problems. */
export function drizzleProblems(root: string, folder: string): Array<string> {
  const run = Bun.spawnSync(
    [path.join(root, 'node_modules/.bin/drizzle-kit'), 'check', '--output', 'json'],
    { cwd: path.join(root, folder) },
  );
  const text = run.stdout.toString().trim();
  let output: CheckOutput;
  try {
    output = JSON.parse(text.split('\n').at(-1) ?? '');
  } catch {
    return [`${folder}: drizzle-kit check failed. ${run.stderr.toString().trim() || text}`];
  }
  const notes = [...(output.warnings ?? []), ...(output.errors ?? [])].map(
    (note) =>
      `${folder}: ${note.message ?? 'drizzle-kit check found a problem.'} Run \`mise exec -- bun nx run @repo/${path.basename(folder)}:db-generate\`, and commit the migration.`,
  );
  if (output.status !== 'ok' && !notes.length) {
    notes.push(`${folder}: drizzle-kit check returned \`${output.status}\`.`);
  }
  return notes;
}

export function checkDb(root: string): Array<string> {
  return databasePackages(root).flatMap((folder) => {
    const layout = layoutProblems(root, folder);
    return layout.length ? layout : drizzleProblems(root, folder);
  });
}

if (import.meta.main) {
  const problems = checkDb(process.cwd());
  if (problems.length) {
    console.error(
      [
        `Database check failed (${problems.length}).`,
        'Only drizzle-kit writes migrations. See docs/contributing/setup/migrations.md.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Each schema matches its migrations, and drizzle-kit wrote each migration.');
  }
}
