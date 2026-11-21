import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { parse } from 'yaml';

import { phaseNames, phaseStatuses } from '@/tickets/store';
import type { PhaseName, PhaseStatus } from '@/tickets/store';

type StatusEntry = { prompt?: string; skills?: Array<string> };

/** One entry of `.clutch/phases.yaml`: how the driver starts a phase. */
export type PhaseEntry = {
  id: PhaseName;
  thread: 'work' | 'own';
  provider?: string;
  model?: string;
  skills?: Array<string>;
  prompt: string;
  check?: string;
  needs?: Array<'device' | 'dev_stack'>;
  advance?: 'agent' | 'owner';
  statuses?: Partial<Record<PhaseStatus, StatusEntry>>;
};

export type PhaseFile = {
  schemaVersion: 1;
  /** How an agent runs Clutch in this project, such as `mise exec -- bun run clutch`. By default `clutch`. */
  command?: string;
  limits: { threads: number; device: number };
  work_thread: { provider: string; model: string };
  phases: Array<PhaseEntry>;
};

export const phaseFilePath = (root: string) => path.join(root, '.clutch', 'phases.yaml');

type Shape = Record<string, (value: unknown) => boolean>;

const isText = (value: unknown) => typeof value === 'string' && value.trim() !== '';
const isCount = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;
const isList = (allowed?: ReadonlyArray<string>) => (value: unknown) =>
  Array.isArray(value) &&
  value.every((item) => isText(item) && (!allowed || allowed.includes(item as string)));
const isOneOf = (allowed: ReadonlyArray<string>) => (value: unknown) =>
  allowed.includes(value as string);

const statusShape: Shape = { prompt: isText, skills: isList() };
const entryShape: Shape = {
  id: isOneOf(phaseNames),
  thread: isOneOf(['work', 'own']),
  provider: isText,
  model: isText,
  skills: isList(),
  prompt: isText,
  check: isText,
  needs: isList(['device', 'dev_stack']),
  advance: isOneOf(['agent', 'owner']),
  statuses: () => true,
};

/** The error of each key of `value` that `shape` does not name or whose value it refuses. */
function shapeErrors(where: string, value: unknown, shape: Shape, required: Array<string>) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [`${where} must be a mapping.`];
  }
  const record = value as Record<string, unknown>;
  return [
    ...required.filter((key) => !(key in record)).map((key) => `${where} needs ${key}.`),
    ...Object.entries(record).flatMap(([key, item]) => {
      const check = shape[key];
      if (!check) {
        return [`${where} has an unknown key: ${key}.`];
      }
      return check(item) ? [] : [`${where}.${key} has a value that is not allowed.`];
    }),
  ];
}

/** Each error of a parsed phase file. Empty when the file is valid. */
function phaseFileErrors(data: unknown) {
  const errors = shapeErrors(
    'The phase file',
    data,
    {
      schemaVersion: (value) => value === 1,
      command: isText,
      limits: () => true,
      work_thread: () => true,
      phases: Array.isArray,
    },
    ['schemaVersion', 'limits', 'work_thread', 'phases'],
  );
  if (errors.length > 0) {
    return errors;
  }
  const file = data as PhaseFile;
  errors.push(
    ...shapeErrors('limits', file.limits, { threads: isCount, device: isCount }, [
      'threads',
      'device',
    ]),
    ...shapeErrors('work_thread', file.work_thread, { provider: isText, model: isText }, [
      'provider',
      'model',
    ]),
  );
  const seen = new Set<unknown>();
  for (const [index, entry] of file.phases.entries()) {
    const where = `phases[${index}]`;
    errors.push(...shapeErrors(where, entry, entryShape, ['id', 'thread', 'prompt']));
    if (seen.has(entry?.id)) {
      errors.push(`${where} repeats the phase ${String(entry.id)}.`);
    }
    seen.add(entry?.id);
    if (entry && 'provider' in entry !== 'model' in entry) {
      errors.push(`${where} needs provider and model together.`);
    }
    for (const [status, prompt] of Object.entries(entry?.statuses ?? {})) {
      errors.push(
        ...(isOneOf(phaseStatuses)(status)
          ? shapeErrors(`${where}.statuses.${status}`, prompt, statusShape, [])
          : [`${where}.statuses has an unknown status: ${status}.`]),
      );
    }
  }
  return errors;
}

/** The phase file of the checkout at `root`, or null when it has none. Throws on an invalid file. */
export async function readPhaseFile(root: string): Promise<PhaseFile | null> {
  const file = phaseFilePath(root);
  if (!existsSync(file)) {
    return null;
  }
  const data: unknown = parse(await readFile(file, 'utf-8'));
  const errors = phaseFileErrors(data);
  if (errors.length > 0) {
    throw new Error(`${file} is not valid:\n${errors.join('\n')}`);
  }
  return data as PhaseFile;
}

/** The folders where a skill for the agent can be installed. */
const skillFolders = (root: string) => [
  path.join(root, '.agents', 'skills'),
  path.join(homedir(), '.claude', 'skills'),
  path.join(homedir(), '.agents', 'skills'),
];

/** Each skill that the phase file names and that has no `SKILL.md` in a skill folder. */
export function missingSkills(file: PhaseFile, root: string) {
  const named = file.phases.flatMap((entry) => [
    ...(entry.skills ?? []),
    ...Object.values(entry.statuses ?? {}).flatMap((status) => status?.skills ?? []),
  ]);
  return [...new Set(named)].filter(
    (skill) =>
      !skillFolders(root).some((folder) => existsSync(path.join(folder, skill, 'SKILL.md'))),
  );
}
