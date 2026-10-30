import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { git, gitOrThrow } from '@/git';
import { ownerPattern, phases } from '@/issues/parse';

const issuesDir = '.clutch/issues';
const fileId = /^(CL-(\d{3}))[a-z]?\.md$/u;
const rangePattern = /^CL-(\d{3})\.\.CL-(\d{3})$/u;
const idPattern = /^CL-\d{3}[a-z]?$/u;

type Range = { low: number; high: number };

/** The id numbers of each phase. See .clutch/README.md#id-ranges. */
const phaseRanges: Record<string, Range> = {
  P0: { low: 1, high: 99 },
  P1: { low: 100, high: 199 },
  P2: { low: 200, high: 299 },
  P3: { low: 300, high: 399 },
  P4: { low: 400, high: 499 },
  P5: { low: 500, high: 599 },
  RN: { low: 600, high: 699 },
  RB: { low: 700, high: 799 },
  later: { low: 900, high: 999 },
};

const idOf = (number: number) => `CL-${String(number).padStart(3, '0')}`;

/** Reads `--range CL-118..CL-120` into its bounds. */
export function parseRange(text: string): Range {
  const match = rangePattern.exec(text);
  const [low, high] = match ? [Number(match[1]), Number(match[2])] : [0, -1];
  if (!match || low > high) {
    throw new Error(`--range takes CL-NNN..CL-NNN, low to high. Got ${text}.`);
  }
  return { low, high };
}

/**
 * The next free id in `range`: one above the highest id taken in it, so an id
 * that a renumbered or deleted issue once used never comes back.
 */
export function nextId(taken: Set<number>, range: Range) {
  let next = range.low;
  for (const number of taken) {
    if (number >= range.low && number <= range.high && number >= next) {
      next = number + 1;
    }
  }
  if (next > range.high) {
    throw new Error(`No free id in ${idOf(range.low)}..${idOf(range.high)}.`);
  }
  return idOf(next);
}

/**
 * The id numbers that any issue file uses in the working tree, committed or
 * not, in each local
 * branch, or in each `origin/*` branch. A letter suffix uses its number too.
 */
async function takenIds(root: string) {
  const taken = new Set<number>();
  const add = (name: string) => {
    const match = fileId.exec(name);
    if (match) {
      taken.add(Number(match[2]));
    }
  };
  const local = await readdir(path.join(root, issuesDir)).catch(() => []);
  for (const name of local) {
    add(name);
  }
  const refs = await gitOrThrow(
    root,
    'for-each-ref',
    '--format=%(refname)',
    'refs/heads',
    'refs/remotes/origin',
  );
  for (const ref of refs.split('\n').filter((name) => name && !name.endsWith('/HEAD'))) {
    const files = await git(root, 'ls-tree', '--name-only', ref, `${issuesDir}/`);
    for (const file of files.out.split('\n')) {
      add(path.basename(file));
    }
  }
  return taken;
}

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;

/** The issue file as `.clutch/README.md#frontmatter` describes it, with `status: todo`. */
export function issueText(issue: {
  id: string;
  title: string;
  phase: string;
  dependsOn: Array<string>;
  owner: string;
}) {
  return [
    '---',
    `id: ${issue.id}`,
    `title: ${quote(issue.title)}`,
    `phase: ${issue.phase}`,
    'status: todo',
    `depends_on: [${issue.dependsOn.join(', ')}]`,
    "pr: ''",
    `owner: ${issue.owner}`,
    '---',
    '',
    `# ${issue.id}: ${issue.title}`,
    '',
    ...['Goal', 'Context', 'Steps', 'Files', 'Acceptance criteria', 'Verify'].flatMap((section) => [
      `## ${section}`,
      '',
    ]),
  ].join('\n');
}

type NewOptions = {
  phase?: string;
  title?: string;
  depends?: string;
  owner?: string;
  range?: string;
};

/**
 * `clutch issues new`: fetches origin, picks the next free id in the phase's
 * range or in `--range` across every branch, and writes the issue file.
 * Returns the id and the file.
 */
export async function newIssue(root: string, options: NewOptions) {
  const { phase, title } = options;
  if (!phase || !(phases as ReadonlyArray<string>).includes(phase)) {
    throw new Error(`--phase must be one of ${phases.join(', ')}.`);
  }
  if (!title?.trim()) {
    throw new Error('--title needs the issue title.');
  }
  const owner = options.owner ?? 'agent';
  if (!ownerPattern.test(owner)) {
    throw new Error(`Owner must be agent, brendan or an agent name. Got ${owner}.`);
  }
  const dependsOn = (options.depends ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const badDep = dependsOn.find((id) => !idPattern.test(id));
  if (badDep) {
    throw new Error(`--depends takes issue ids such as CL-104. Got ${badDep}.`);
  }
  const remotes = await gitOrThrow(root, 'remote');
  if (remotes.split('\n').includes('origin')) {
    await gitOrThrow(root, 'fetch', '--quiet', '--prune', 'origin');
  }
  const range = options.range ? parseRange(options.range) : phaseRanges[phase];
  const id = nextId(await takenIds(root), range);
  const file = `${issuesDir}/${id}.md`;
  await mkdir(path.join(root, issuesDir), { recursive: true });
  await writeFile(
    path.join(root, file),
    issueText({ id, title: title.trim(), phase, dependsOn, owner }),
    { flag: 'wx' },
  );
  return { id, file };
}
