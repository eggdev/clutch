import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { stringify } from 'yaml';

const root = path.resolve(import.meta.dir, '../..');

/**
 * Writes the files into a new directory, lints it, and lists `path rule` for
 * each diagnostic from `plugins`. A `repo-imports` rule shows its name alone;
 * any other shows as `plugin/rule`.
 */
export async function lint(
  files: Record<string, string>,
  plugins: ReadonlyArray<string> = ['repo-imports'],
): Promise<Array<string>> {
  const directory = await mkdtemp(path.join(tmpdir(), 'import-rule-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      await mkdir(path.resolve(directory, name, '..'), { recursive: true });
      await writeFile(path.join(directory, name), source);
    }
    const run = Bun.spawnSync([
      path.resolve(root, 'node_modules/.bin/oxlint'),
      '-c',
      path.resolve(root, 'oxlint.config.ts'),
      '--format',
      'json',
      directory,
    ]);
    const result = JSON.parse(run.stdout.toString());
    const lines: Array<string> = result.diagnostics
      .filter((item: { code: string }) =>
        plugins.some((plugin) => item.code.startsWith(`${plugin}(`)),
      )
      .map((item: { code: string; filename: string }) => {
        const [, plugin, rule] = /^(.+)\((.+)\)$/u.exec(item.code) ?? [];
        const name = plugin === 'repo-imports' ? rule : `${plugin}/${rule}`;
        return `${path.relative(directory, item.filename)} ${name}`;
      });
    return lines.toSorted();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** A package primitive whose code root is `packages/<id>/`. */
const primitive = (id: string, vendors: Array<{ vendor: string; imports: string }> = []) => ({
  id,
  group: 'platform',
  name: id,
  kind: 'package',
  summary: `The ${id} package.`,
  code: [`packages/${id}/`],
  docs: [],
  vendors,
});

/** A filled primitives registry, as kickoff writes it for a project. */
export const fixtureRegistry = {
  version: 1,
  groups: [{ id: 'platform', name: 'Platform' }],
  primitives: [
    primitive('sync', [{ vendor: 'Automerge', imports: '^@automerge/' }]),
    primitive('identity', [
      {
        vendor: 'Better Auth',
        imports: '^(?:@better-auth/|better-auth(?:/|$)|better-call(?:/|$))',
      },
    ]),
    primitive('billing', [{ vendor: 'Stripe', imports: '^stripe(?:/|$)' }]),
    primitive('document-extraction', [{ vendor: 'unpdf', imports: '^unpdf(?:/|$)' }]),
    primitive('storage'),
    primitive('design-system'),
  ],
  languages: [
    {
      imports: '^drizzle-orm(?:/|$)',
      where: '`repo/` and `@repo/storage`',
      primitives: ['storage'],
      packagePaths: ['repo/'],
    },
    {
      imports: '^one(?:/|$)',
      where: '`apps/app/app/**` and the config files in `apps/app/`',
      files: ['/apps/app/app/', '/apps/app/[^/]+\\.config\\.[cm]?[jt]s$'],
    },
    {
      imports: '^react(?:-native)?(?:/|$)',
      where: '`ui/`, features, `@repo/design-system` and `apps/app`',
      primitives: ['design-system'],
      packagePaths: ['ui/'],
      files: ['/apps/app/', '/features/'],
    },
  ],
  invariants: [],
};
export const fixtureRegistryYaml = stringify(fixtureRegistry);

/** A server app's package.json. Only a server app imports server code. */
export const serverApp = JSON.stringify({ nx: { tags: ['platform:server'] } });
