import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** The friction log of a repository, one JSON object on each line. See docs/contributing/capabilities/friction-log.md. */
export const frictionFile = '.clutch/friction.jsonl';

const frictionKinds = ['tooling', 'docs', 'check', 'flake'] as const;
export type FrictionKind = (typeof frictionKinds)[number];

/** One entry. `at` is an ISO time and the entry's key: gardening names a handled entry by it. */
export type FrictionEntry = {
  readonly at: string;
  readonly issue: string | null;
  readonly kind: FrictionKind;
  readonly text: string;
  readonly branch: string | null;
};

const issuePattern = /^CL-\d{3}[a-z]?$/u;

/** Throws with the fix when an entry's fields are not valid. */
function checkEntry(entry: FrictionEntry): FrictionEntry {
  if (!entry.text.trim()) {
    throw new Error('Give the friction as text: clutch friction add "<what slowed you down>".');
  }
  if (entry.text.includes('\n')) {
    throw new Error('Keep the friction text on one line.');
  }
  if (!frictionKinds.includes(entry.kind)) {
    throw new Error(`--kind is one of ${frictionKinds.join(', ')}, not ${entry.kind}.`);
  }
  if (entry.issue !== null && !issuePattern.test(entry.issue)) {
    throw new Error(`--issue takes an id such as CL-306, not ${entry.issue}.`);
  }
  return entry;
}

/** Appends one entry as one line, so the file stays valid JSONL even when it lacked a final newline. */
export async function appendEntry(file: string, entry: FrictionEntry) {
  checkEntry(entry);
  await mkdir(path.dirname(file), { recursive: true });
  const before = await readFile(file, 'utf-8').catch(() => '');
  const separator = before && !before.endsWith('\n') ? '\n' : '';
  await appendFile(file, `${separator}${JSON.stringify(entry)}\n`);
}

/** Every entry in the file, oldest first. A line that is not an entry fails with its line number. */
export async function readEntries(file: string): Promise<Array<FrictionEntry>> {
  const text = await readFile(file, 'utf-8').catch(() => '');
  return text
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line)
    .map(({ line, number }) => {
      try {
        return checkEntry(JSON.parse(line) as FrictionEntry);
      } catch (error) {
        throw new Error(`${file}:${number} is not a friction entry: ${(error as Error).message}`, {
          cause: error,
        });
      }
    });
}

/** The milliseconds in a span such as `7d` or `12h`. */
function spanMs(span: string): number {
  const match = /^(\d+)([dh])$/u.exec(span);
  if (!match) {
    throw new Error(`--since takes a span such as 7d or 12h, not ${span}.`);
  }
  return Number(match[1]) * (match[2] === 'd' ? 86_400_000 : 3_600_000);
}

/** The entries at or after `now` minus `span`. */
export function since(entries: ReadonlyArray<FrictionEntry>, span: string, now: Date) {
  const from = now.getTime() - spanMs(span);
  return entries.filter((entry) => Date.parse(entry.at) >= from);
}
