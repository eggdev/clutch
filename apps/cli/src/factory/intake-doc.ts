import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { intakeOf } from '@/clutch-config/intake';
import type { Intake } from '@/clutch-config/intake';
import type { ClutchConfig } from '@/clutch-config/schema';
import type { Problem } from '@/factory/tree';

/**
 * The "Ready for the factory" section of `.clutch/README.md` must name the
 * same labels and states as `factory.intake` in clutch.yaml, so a person and
 * C-Suite's intake read one answer. The check runs when the section exists or
 * when clutch.yaml sets `factory.intake`. The section holds one list line for
 * each key, and each value is in backticks:
 *
 *   - GitHub: an issue with the label `factory`.
 *   - Linear: no label.
 *   - Tracker: an issue file with `status: todo` and `owner: agent`, outside `later`.
 */

const trackerReadme = '.clutch/README.md';
const heading = 'Ready for the factory';
const lines = { github: 'GitHub', linear: 'Linear', tracker: 'Tracker' } as const;
type Key = keyof typeof lines;

/** The text of the section, without its heading, or null when the file has no such section. */
function sectionOf(text: string) {
  const start = text.split('\n').findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) {
    return null;
  }
  const rest = text.split('\n').slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2} /u.test(line));
  return rest.slice(0, end === -1 ? undefined : end);
}

/** The values that the section names for each key, or undefined for a key with no line. */
export function readIntakeSection(text: string): Partial<Intake> | null {
  const section = sectionOf(text);
  if (!section) {
    return null;
  }
  const found: Partial<Intake> = {};
  for (const [key, label] of Object.entries(lines) as Array<[Key, string]>) {
    const line = section.find((item) => item.startsWith(`- ${label}:`));
    if (line === undefined) {
      continue;
    }
    const values = [...line.matchAll(/`([^`]+)`/gu)].map((match) => match[1]);
    found[key] =
      key === 'tracker'
        ? values.flatMap((value) => /^status: (\S+)$/u.exec(value)?.[1] ?? [])
        : values;
  }
  return found;
}

const show = (list: Array<string>) =>
  list.length === 0 ? 'none' : list.map((item) => `\`${item}\``).join(', ');
const same = (a: Array<string>, b: Array<string>) =>
  a.length === b.length && a.every((item) => b.includes(item));

async function readText(file: string) {
  try {
    return await readFile(file, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** The problems between the section and `factory.intake`. Each `file` is from the project root. */
export async function checkIntakeDoc(project: string, config: ClutchConfig | undefined) {
  const set = config?.factory?.intake !== undefined;
  const text = await readText(path.join(project, trackerReadme));
  const section = text === null ? null : readIntakeSection(text);
  const problems: Array<Problem> = [];
  const add = (key: string, reason: string) => problems.push({ file: trackerReadme, key, reason });
  if (!section) {
    if (set) {
      add(
        '',
        `clutch.yaml sets factory.intake, so this file needs a "## ${heading}" section that names the same labels and states.`,
      );
    }
    return problems;
  }
  const intake = intakeOf(config);
  for (const [key, label] of Object.entries(lines) as Array<[Key, string]>) {
    const named = section[key];
    if (named === undefined) {
      add(key, `The "${heading}" section has no "- ${label}:" line.`);
    } else if (!same(named, intake[key])) {
      const source = set
        ? `factory.intake.${key} in clutch.yaml`
        : `the default factory.intake.${key}`;
      add(key, `The section names ${show(named)}, and ${source} names ${show(intake[key])}.`);
    }
  }
  return problems;
}
