import { existsSync } from 'node:fs';
import path from 'node:path';

import { blankFences } from '@tools/docs-files';

/**
 * Each key in the root package.json `overrides` or `resolutions` has a `###`
 * heading in the overrides section of the dependencies page. The first code
 * span of the heading names the package, and text under it gives the reason.
 * A heading for a package with no override is stale. package.json repeats no
 * key, because JSON keeps only the last value.
 */
export const page = 'docs/contributing/setup/dependencies.md';
const section = '## Overrides';

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

export type Entry = { name: string; line: number; reason: boolean };

/** The `###` headings in the overrides section, with whether text follows each one. */
export function documentedOverrides(content: string): Array<Entry> {
  const entries: Array<Entry> = [];
  let inside = false;
  let current: Entry | null = null;
  for (const [index, line] of blankFences(content).split('\n').entries()) {
    if (/^#{1,3}\s/u.test(line)) {
      if (/^#{1,2}\s/u.test(line)) {
        inside = line.trim() === section;
      }
      const name = inside && /^###\s/u.test(line) ? /`([^`]+)`/u.exec(line)?.[1] : undefined;
      current = name ? { name, line: index + 1, reason: false } : null;
      if (current) {
        entries.push(current);
      }
    } else if (current && line.trim()) {
      current.reason = true;
    }
  }
  return entries;
}

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
  const entries = existsSync(path.join(root, page))
    ? documentedOverrides(await Bun.file(path.join(root, page)).text())
    : [];
  for (const [name, field] of overrides) {
    if (!entries.some((entry) => entry.name === name)) {
      errors.push(
        `package.json: \`${field}.${name}\` has no heading in ${page}. Add "### \`${name}\`" under "${section}" with the reason.`,
      );
    }
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      errors.push(`${page}:${entry.line}: \`${entry.name}\` has a second heading. Merge them.`);
    }
    seen.add(entry.name);
    if (!overrides.has(entry.name)) {
      errors.push(
        `${page}:${entry.line}: \`${entry.name}\` is not in package.json overrides. Delete the stale section.`,
      );
    } else if (!entry.reason) {
      errors.push(
        `${page}:${entry.line}: \`${entry.name}\` has no reason. Say why the override exists and what removes it.`,
      );
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
        `Keep package.json overrides and ${page} in step.`,
        '',
        ...errors,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Each dependency override has a documented reason.');
  }
}
