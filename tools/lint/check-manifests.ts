import path from 'node:path';

/** Oxlint handles source files; this companion check covers JSON manifests. */
export async function checkManifests(root: string): Promise<Array<string>> {
  const workspace = await Bun.file(path.resolve(root, 'package.json')).json();
  const patterns: Array<string> = workspace.workspaces || [];
  const exclusions = patterns
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => new Bun.Glob(`${pattern.slice(1)}/package.json`));
  const files = new Set(['package.json']);
  for (const pattern of patterns.filter((entry) => !entry.startsWith('!'))) {
    for await (const file of new Bun.Glob(`${pattern}/package.json`).scan({ cwd: root })) {
      if (!exclusions.some((glob) => glob.match(file))) {
        files.add(file);
      }
    }
  }
  const errors: Array<string> = [];
  for (const file of files) {
    const manifest = await Bun.file(path.resolve(root, file)).json();
    if (Object.hasOwn(manifest, 'exports')) {
      errors.push(
        `${file}: package exports are forbidden; use TypeScript path aliases to source files.`,
      );
    }
    const tags: Array<string> = manifest.nx?.tags ?? [];
    const kinds = tags.filter((tag) => tag.startsWith('type:'));
    const allowed = file.startsWith('packages/') ? ['type:package', 'type:tool'] : ['type:feature'];
    if (
      (file.startsWith('packages/') || file.startsWith('features/')) &&
      (kinds.length !== 1 || !allowed.includes(kinds[0]))
    ) {
      errors.push(
        `${file}: needs exactly one Nx tag, ${allowed.join(' or ')}. See docs/contributing/import-boundaries.md.`,
      );
    }
  }
  return errors;
}

if (import.meta.main) {
  const errors = await checkManifests(path.resolve(import.meta.dir, '../..'));
  if (errors.length) {
    console.error(
      [
        `Manifest check failed (${errors.length}).`,
        'Fix each package.json below. See docs/contributing/import-boundaries.md.',
        '',
        ...errors,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log(
      'Workspace manifests have no exports maps, and each package and feature has one type tag.',
    );
  }
}
