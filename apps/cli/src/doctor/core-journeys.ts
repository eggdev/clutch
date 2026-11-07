import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { coreJourneys } from '@/clutch-config/core-journeys';
import type { CoreJourney } from '@/clutch-config/core-journeys';
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

const catalog = 'See docs/contributing/journeys/core.md.';

/** Whether a feature has screens: `features/<name>/screens`. A repo with none ships no product yet. */
async function shipsScreens(root: string) {
  const features = await entries(path.join(root, 'features'));
  return features.some(
    (entry) =>
      entry.isDirectory() && existsSync(path.join(root, 'features', entry.name, 'screens')),
  );
}

/** The budgets that an adopted set of core journeys needs: layout shift, time to value, and clicks for each one. */
function missingBudgets(config: ClutchConfig, adopted: ReadonlyArray<string>) {
  if (adopted.length === 0) {
    return [];
  }
  const { budgets } = config;
  return [
    ...(budgets?.layoutShift === undefined ? ['budgets.layoutShift'] : []),
    ...(budgets?.timeToValue === undefined ? ['budgets.timeToValue'] : []),
    ...adopted
      .filter((name) => budgets?.clicks?.[name as CoreJourney] === undefined)
      .map((name) => `budgets.clicks.${name}`),
  ];
}

/**
 * The `clutch doctor --check` failures for core journeys:
 *
 * - a project past kickoff (no KICKOFF.md) that ships screens and whose
 *   clutch.yaml has no `coreJourneys`, so no core journey is checked at all
 * - a budget that the adopted core journeys need and that `budgets` lacks
 * - each adopted core journey that no journey proves
 *
 * The template keeps KICKOFF.md, so it has none of the first. See
 * docs/contributing/journeys/core.md.
 */
export async function coreJourneyFindings(root: string, config: ClutchConfig | undefined) {
  if (!config?.coreJourneys) {
    return existsSync(path.join(root, 'KICKOFF.md')) || !(await shipsScreens(root))
      ? []
      : [
          {
            id: 'core:unrecorded',
            kind: 'core journeys unrecorded',
            message: `core journeys unrecorded: kickoff is done and features have screens, but clutch.yaml has no \`coreJourneys\`, so no core journey is checked. Record each one as adopted, or n/a with a reason. ${catalog}`,
          },
        ];
  }
  const adopted = coreJourneys.filter((name) => config.coreJourneys?.[name].status === 'adopted');
  const budgets = missingBudgets(config, adopted).map((key) => ({
    id: `core:${key}`,
    kind: 'budget missing',
    message: `budget missing: ${key} is not set in clutch.yaml, and the adopted core journeys need it. ${catalog}`,
  }));
  const proven = await provenCoreJourneys(root);
  return [
    ...budgets,
    ...adopted
      .filter((name) => !proven.has(name))
      .map((name) => ({
        id: `core:${name}`,
        kind: 'core journey missing',
        message: `core journey missing: ${name} is adopted in clutch.yaml, but no journey has \`Core: ${name}\`. Add features/<feature>/journeys/<id>.pw.ts from .agents/skills/setup-verification/references/core-journeys/${name}.md, or record it as n/a with a reason. See docs/contributing/journeys/core.md.`,
      })),
  ];
}
