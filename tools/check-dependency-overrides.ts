import { existsSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

/**
 * Each key in the root package.json `overrides` or `resolutions` has one entry
 * in tools/dependency-overrides.yaml, with its reason and the event that
 * removes it. An entry for a package with no override is stale. package.json
 * repeats no key, because JSON keeps only the last value. See
 * docs/contributing/setup/dependencies.md#overrides.
 */
export const registry = 'tools/dependency-overrides.yaml';

/** The path of each key that repeats in its object. The source must be valid JSON. */
export function duplicateKeys(source: string): Array<string> {
  JSON.parse(source);
  const duplicates: Array<string> = [];
  let index = 0;
  const space = () => {
    while (/\s/u.test(source[index] ?? '')) {
      index++;
    }
  };
  const string = () => {
    const start = index++;
    while (source[index] !== '"') {
      index += source[index] === '\\' ? 2 : 1;
    }
    return JSON.parse(source.slice(start, ++index)) as string;
  };
  const value = (location: string): void => {
    space();
    const open = source[index];
    if (open === '{' || open === '[') {
      index++;
      space();
      const seen = new Set<string>();
      for (let item = 0; source[index] !== (open === '{' ? '}' : ']'); item++) {
        space();
        if (open === '[') {
          value(`${location}[${item}]`);
        } else {
          const key = string();
          const keyPath = location ? `${location}.${key}` : key;
          if (seen.has(key)) {
            duplicates.push(keyPath);
          }
          seen.add(key);
          space();
          index++;
          value(keyPath);
        }
        space();
        if (source[index] === ',') {
          index++;
        }
        space();
      }
      index++;
    } else if (open === '"') {
      string();
    } else {
      while (index < source.length && !/[\s,}\]]/u.test(source[index])) {
        index++;
      }
    }
  };
  value('');
  return duplicates;
}

export type Entry = { package?: string; reason?: string; revisit?: string };

export async function checkDependencyOverrides(root: string): Promise<Array<string>> {
  const source = await Bun.file(path.join(root, 'package.json')).text();
  const errors = duplicateKeys(source).map(
    (keyPath) =>
      `package.json: \`${keyPath}\` repeats. JSON keeps only the last value. Delete one.`,
  );
  const manifest = JSON.parse(source);
  const overrides = new Map<string, string>();
  for (const field of ['overrides', 'resolutions']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      overrides.set(name, field);
    }
  }
  const file = path.join(root, registry);
  const entries: Array<Entry> = existsSync(file) ? (parse(await Bun.file(file).text()) ?? []) : [];
  for (const [name, field] of overrides) {
    if (!entries.some((entry) => entry.package === name)) {
      errors.push(
        `package.json: \`${field}.${name}\` has no entry in ${registry}. Add one with its reason and the event that removes it.`,
      );
    }
  }
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const name = entry.package ?? `[${index}]`;
    if (seen.has(name)) {
      errors.push(`${registry}: \`${name}\` has a second entry. Merge them.`);
    }
    seen.add(name);
    if (!overrides.has(name)) {
      errors.push(
        `${registry}: \`${name}\` is not in package.json overrides. Delete the stale entry.`,
      );
    }
    for (const field of ['reason', 'revisit'] as const) {
      if (!entry[field]?.trim()) {
        errors.push(`${registry}: \`${name}\` has no \`${field}\`. Add it.`);
      }
    }
  }
  return errors;
}

if (import.meta.main) {
  const errors = await checkDependencyOverrides(process.cwd());
  if (errors.length) {
    console.error(
      [
        `Dependency override check failed (${errors.length}).`,
        `Keep package.json overrides and ${registry} in step.`,
        '',
        ...errors,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Each dependency override has a documented reason.');
  }
}
