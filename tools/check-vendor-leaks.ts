import { existsSync } from 'node:fs';
import path from 'node:path';

import { parseRegistry, readRegistry } from '@tools/lint/import-policy.mjs';

/**
 * No public section shows a vendor. Lint keeps vendor imports out of public
 * files, but an inferred type can still carry a vendor type into a public
 * declaration. This check builds each product package's declarations and
 * reads the public ones. See docs/principles/generic-platform.md.
 */
export const publicSections = ['types', 'models', 'commands', 'service', 'ui'];
const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/gu;

/** The folders under `packages/` with the Nx tag `type:package`. */
export async function productPackages(root: string): Promise<Array<string>> {
  const names: Array<string> = [];
  for await (const file of new Bun.Glob('packages/*/package.json').scan({ cwd: root })) {
    const manifest = await Bun.file(path.join(root, file)).json();
    if ((manifest.nx?.tags ?? []).includes('type:package')) {
      names.push(file.split('/')[1]);
    }
  }
  return names.toSorted();
}

/** The source file of a declaration, for the message: `.ts` or `.tsx`. */
function sourceOf(root: string, name: string, declaration: string): string {
  const base = `packages/${name}/${declaration.replace(/\.d\.ts$/u, '')}`;
  return existsSync(path.join(root, `${base}.tsx`)) ? `${base}.tsx` : `${base}.ts`;
}

/** Reads the built public declarations of each product package and names each vendor they show. */
export async function findVendorLeaks(root: string): Promise<Array<string>> {
  const { vendors } = parseRegistry(readRegistry(root) ?? {});
  const problems: Array<string> = [];
  for (const name of await productPackages(root)) {
    const out = path.join(root, 'packages', name, 'out-tsc/lib');
    const pattern = `{${publicSections.join(',')}}/**/*.d.ts`;
    for await (const declaration of new Bun.Glob(pattern).scan({ cwd: out })) {
      const text = await Bun.file(path.join(out, declaration)).text();
      for (const [, value] of text.matchAll(specifier)) {
        const vendor = vendors.find((rule: { pattern: RegExp }) => rule.pattern.test(value));
        if (vendor) {
          problems.push(
            `${sourceOf(root, name, declaration)}: its public types show ${vendor.vendor} (\`${value}\`). Give the export a type of this package's own in \`types/\`, and keep the vendor type in \`config/\`, \`repo/\` or \`runtime/\`.`,
          );
        }
      }
    }
  }
  return [...new Set(problems)].toSorted();
}

/** Builds the declarations of each product package, then reads them. */
export async function checkVendorLeaks(root: string): Promise<Array<string>> {
  const names = await productPackages(root);
  const projects = names.map((name) => `packages/${name}/tsconfig.lib.json`);
  if (projects.length) {
    const build = Bun.spawnSync(
      [path.join(root, 'node_modules/.bin/tsgo'), '--build', ...projects],
      { cwd: root },
    );
    if (build.exitCode !== 0) {
      return [`tsgo --build failed. Run \`mise exec -- bun run check\` for the type errors.`];
    }
  }
  return findVendorLeaks(root);
}

if (import.meta.main) {
  const problems = await checkVendorLeaks(process.cwd());
  if (problems.length) {
    console.error(
      [
        `Vendor leak check failed (${problems.length}).`,
        'A change of vendor edits one package. See docs/principles/generic-platform.md.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('No public section of a package shows a vendor type.');
  }
}
