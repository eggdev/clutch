import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadClutchConfig } from '@/clutch-config/load';

const codeownersFiles = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

/**
 * The default owner in CODEOWNERS: the owner of the `*` rule, or else the
 * person that the file names most often. A team, `@org/team`, is no login.
 */
export function codeownersDefault(text: string): string | undefined {
  const counts = new Map<string, number>();
  let star: string | undefined;
  for (const line of text.split('\n')) {
    const [pattern, ...owners] = line.replace(/#.*$/u, '').trim().split(/\s+/u);
    const people = owners
      .filter((owner) => owner.startsWith('@') && !owner.includes('/'))
      .map((owner) => owner.slice(1));
    if (!pattern || people.length === 0) {
      continue;
    }
    if (pattern === '*') {
      star = people[0];
    }
    for (const person of people) {
      counts.set(person, (counts.get(person) ?? 0) + 1);
    }
  }
  let most: string | undefined;
  for (const [person, count] of counts) {
    if (!most || count > (counts.get(most) ?? 0)) {
      most = person;
    }
  }
  return star ?? most;
}

/**
 * The GitHub login whose reactions grade the dry-run verdicts: `flag`, then
 * `automerge.owner` in clutch.yaml, then the default owner in CODEOWNERS.
 */
export async function verdictOwner(root: string, flag?: string) {
  if (flag) {
    return flag.replace(/^@/u, '');
  }
  const loaded = await loadClutchConfig(root);
  if (loaded.kind === 'loaded' && loaded.config.automerge?.owner) {
    return loaded.config.automerge.owner;
  }
  for (const file of codeownersFiles) {
    const text = await readFile(path.join(root, file), 'utf-8').catch(() => '');
    const owner = codeownersDefault(text);
    if (owner) {
      return owner;
    }
  }
  return null;
}
