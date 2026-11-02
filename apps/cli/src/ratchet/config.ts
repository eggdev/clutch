import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Where a repository keeps its ratchets. It is a guardrail file. */
const ratchetsFile = '.clutch/ratchets.json';

/**
 * One ratchet: the violations of one rule, counted for each file. `pattern` is
 * a regular expression counted in each file that `files` matches. `command`
 * prints `path:count` lines instead, such as for lint output. `counts` is the
 * baseline, which may only go down. See decision 0001.
 */
export type Ratchet = {
  pattern?: string;
  command?: string;
  files: string;
  counts: Record<string, number>;
};

export type Ratchets = { schemaVersion: 1; ratchets: Record<string, Ratchet> };

const isCounts = (value: unknown): value is Record<string, number> =>
  typeof value === 'object' &&
  value !== null &&
  Object.values(value).every((count) => Number.isInteger(count) && (count as number) > 0);

/** The problems in parsed `.clutch/ratchets.json` data, each with its ratchet name. */
export function validateRatchets(data: unknown): Array<string> {
  const value = data as Partial<Ratchets> | null;
  if (value?.schemaVersion !== 1 || typeof value.ratchets !== 'object' || !value.ratchets) {
    return ['Expected { "schemaVersion": 1, "ratchets": { ... } }.'];
  }
  const problems: Array<string> = [];
  for (const [name, ratchet] of Object.entries(value.ratchets)) {
    if (!/^[a-z][a-z0-9-]*$/u.test(name)) {
      problems.push(`${name}: a name is lowercase words joined by hyphens.`);
    }
    if (Boolean(ratchet.pattern) === Boolean(ratchet.command)) {
      problems.push(`${name}: give exactly one of pattern and command.`);
    }
    if (ratchet.pattern) {
      try {
        const valid = new RegExp(ratchet.pattern, 'gu');
        valid.lastIndex = 0;
      } catch {
        problems.push(`${name}: pattern is not a valid regular expression.`);
      }
    }
    if (typeof ratchet.files !== 'string' || !ratchet.files) {
      problems.push(`${name}: files is a glob, such as "src/**/*.ts".`);
    }
    if (!isCounts(ratchet.counts)) {
      problems.push(`${name}: counts maps each path to a whole number above 0.`);
    }
  }
  return problems;
}

/** The repository's ratchets, or an empty set when it has no ratchets file. */
export async function readRatchets(root: string): Promise<Ratchets> {
  const text = await readFile(path.join(root, ratchetsFile), 'utf-8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return '{"schemaVersion":1,"ratchets":{}}';
      }
      throw error;
    },
  );
  const data = JSON.parse(text) as unknown;
  const problems = validateRatchets(data);
  if (problems.length > 0) {
    throw new Error(problems.map((problem) => `${ratchetsFile}: ${problem}`).join('\n'));
  }
  return data as Ratchets;
}

/** Writes the ratchets with each ratchet's counts sorted by path. */
export async function writeRatchets(root: string, ratchets: Ratchets) {
  const sorted = Object.fromEntries(
    Object.entries(ratchets.ratchets).map(([name, ratchet]) => [
      name,
      {
        ...ratchet,
        counts: Object.fromEntries(
          Object.entries(ratchet.counts).toSorted(([a], [b]) => a.localeCompare(b)),
        ),
      },
    ]),
  );
  await mkdir(path.dirname(path.join(root, ratchetsFile)), { recursive: true });
  await writeFile(
    path.join(root, ratchetsFile),
    `${JSON.stringify({ schemaVersion: 1, ratchets: sorted }, null, 2)}\n`,
  );
}
