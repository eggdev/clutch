import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { coreJourneys } from '@/clutch-config/core-journeys';
import type { ClutchConfig } from '@/clutch-config/schema';

const journeySuffixes = ['.pw.ts', '.maestro.yaml'];

async function entries(folder: string) {
  try {
    return await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/** The header lines of a journey: its leading `/** … *\/` block or `#` comments. */
function headerOf(source: string) {
  const lines = source.split('\n');
  if (lines[0]?.trim() === '/**') {
    return lines.slice(
      1,
      lines.findIndex((line) => line.trim() === '*/'),
    );
  }
  const end = lines.findIndex((line) => !line.startsWith('#'));
  return lines.slice(0, end === -1 ? lines.length : end);
}

/** The core journey that each journey file proves, from the `Core:` line of its header. */
async function provenCoreJourneys(root: string) {
  const proven = new Set<string>();
  for (const feature of await entries(path.join(root, 'features'))) {
    if (!feature.isDirectory()) {
      continue;
    }
    const folder = path.join(root, 'features', feature.name, 'journeys');
    for (const file of await entries(folder)) {
      if (!journeySuffixes.some((suffix) => file.name.endsWith(suffix))) {
        continue;
      }
      const header = headerOf(await readFile(path.join(folder, file.name), 'utf-8'));
      for (const line of header) {
        const match = /^\s*[*#]\s?Core:\s*(\S+)/u.exec(line);
        if (match?.[1]) {
          proven.add(match[1]);
        }
      }
    }
  }
  return proven;
}

/**
 * The `clutch doctor --check` failures for core journeys: each one that
 * `coreJourneys` in clutch.yaml adopts, and that no journey proves. A
 * clutch.yaml with no `coreJourneys` has not run kickoff for them yet, so it
 * has none. See docs/contributing/journeys/core.md.
 */
export async function coreJourneyFindings(root: string, config: ClutchConfig | undefined) {
  if (!config?.coreJourneys) {
    return [];
  }
  const proven = await provenCoreJourneys(root);
  return coreJourneys
    .filter((name) => config.coreJourneys?.[name].status === 'adopted' && !proven.has(name))
    .map((name) => ({
      id: `core:${name}`,
      kind: 'core journey missing',
      message: `core journey missing: ${name} is adopted in clutch.yaml, but no journey has \`Core: ${name}\`. Add features/<feature>/journeys/<id>.pw.ts from .agents/skills/setup-verification/references/core-journeys/${name}.md, or record it as n/a with a reason. See docs/contributing/journeys/core.md.`,
    }));
}
