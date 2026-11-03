import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Rules for design proposals in docs/design/proposals/. The lifecycle and the
 * fields are in .agents/skills/design-proposal/SKILL.md.
 *
 * - The status is proposed, adopted, current or historical.
 * - `directions` lists `today` and 2 or 3 other directions.
 * - A proposed or adopted record has its prototype file. A current or
 *   historical one has none, so dead prototype code goes when the build ships.
 * - An adopted or current record names one of its directions in `adopted`,
 *   and the date of the owner's choice in `decided`.
 * - A historical record says why in `retired`.
 *
 * `--stale` also lists the records that wait too long: a proposal with no
 * choice after 14 days, and an adoption whose issue is done. Weekly gardening
 * runs it. Time never fails `validate`.
 */
export const folder = 'docs/design/proposals';
export const statuses = ['proposed', 'adopted', 'current', 'historical'] as const;
export const staleDays = 14;

type Status = (typeof statuses)[number];
export type Proposal = {
  file: string;
  title?: string;
  status?: Status;
  date?: string;
  issue?: string;
  screen?: string;
  prototype?: string;
  gallery?: string;
  directions?: Array<string>;
  adopted?: string;
  decided?: string;
  retired?: string;
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : undefined);
const day = (value: unknown) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : text(value);

export function parseProposal(file: string, source: string): Proposal | string {
  const header = /^---\n([\s\S]*?)\n---/u.exec(source);
  if (!header) {
    return `${file}: start the record with YAML frontmatter.`;
  }
  let data: Record<string, unknown>;
  try {
    data = (Bun.YAML.parse(header[1]) ?? {}) as Record<string, unknown>;
  } catch {
    return `${file}: the frontmatter is not valid YAML.`;
  }
  const directions = Array.isArray(data.directions) ? data.directions.map(String) : undefined;
  return {
    file,
    title: text(data.title),
    status: text(data.status) as Status | undefined,
    date: day(data.date),
    issue: text(data.issue),
    screen: text(data.screen),
    prototype: text(data.prototype),
    gallery: text(data.gallery),
    directions,
    adopted: text(data.adopted),
    decided: day(data.decided),
    retired: text(data.retired),
  };
}

const isDay = (value?: string) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/u.test(value));
const directionsOf = (p: Proposal) => (p.directions ?? []).filter((id) => id !== 'today');

/** The fields that every record needs, whatever its status. */
function checkFields(p: Proposal): Array<string> {
  const errors: Array<string> = [];
  if (!p.title) {
    errors.push('add a `title`.');
  }
  if (!isDay(p.date)) {
    errors.push('add the `date` the proposal opened, as YYYY-MM-DD.');
  }
  const others = directionsOf(p);
  if (!p.directions?.includes('today') || others.length < 2 || others.length > 3) {
    errors.push('`directions` lists `today` and 2 or 3 other directions.');
  }
  return errors;
}

/** A live record keeps its prototype. A finished one has deleted it. */
function checkPrototype(root: string, p: Proposal): Array<string> {
  const exists = p.prototype ? existsSync(path.join(root, p.prototype)) : false;
  if (p.status === 'current' || p.status === 'historical') {
    return exists ? [`the proposal is ${p.status}, so delete its prototype ${p.prototype}.`] : [];
  }
  const errors: Array<string> = [];
  if (!p.prototype) {
    errors.push('name the `prototype` file that renders the directions.');
  } else if (!exists) {
    errors.push(`the prototype ${p.prototype} does not exist.`);
  }
  if (!p.gallery) {
    errors.push('name the `gallery` route that shows the directions.');
  }
  return errors;
}

/** The owner choice, the shipped screen and the reason for retirement. */
function checkDecision(root: string, p: Proposal): Array<string> {
  const errors: Array<string> = [];
  if (p.status === 'adopted' || p.status === 'current') {
    if (!p.adopted || !directionsOf(p).includes(p.adopted)) {
      errors.push('`adopted` names the direction the owner chose, from `directions`.');
    }
    if (!isDay(p.decided)) {
      errors.push('add the `decided` date of the owner choice, as YYYY-MM-DD.');
    }
  }
  if (p.status === 'current' && p.screen && !existsSync(path.join(root, p.screen))) {
    errors.push(`the proposal is current, but its screen ${p.screen} does not exist.`);
  }
  if (p.status === 'historical' && !p.retired) {
    errors.push(
      'say in `retired` why the design is no longer in use, or name the proposal that replaced it.',
    );
  }
  return errors;
}

export function checkProposal(root: string, p: Proposal): Array<string> {
  if (!p.status || !statuses.includes(p.status)) {
    return [`${p.file}: the status must be one of ${statuses.join(', ')}.`];
  }
  return [...checkFields(p), ...checkPrototype(root, p), ...checkDecision(root, p)].map(
    (message) => `${p.file}: ${message}`,
  );
}

export function readProposals(root: string): Array<Proposal | string> {
  const directory = path.join(root, folder);
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .toSorted()
    .map((file) =>
      parseProposal(`${folder}/${file}`, readFileSync(path.join(directory, file), 'utf-8')),
    );
}

export function checkProposals(root: string): Array<string> {
  return readProposals(root).flatMap((p) => (typeof p === 'string' ? [p] : checkProposal(root, p)));
}

const issueStatus = (root: string, id: string) =>
  /^status:\s*(\S+)/mu.exec(
    existsSync(path.join(root, `.clutch/issues/${id}.md`))
      ? readFileSync(path.join(root, `.clutch/issues/${id}.md`), 'utf-8')
      : '',
  )?.[1];

/** Records that wait too long, with what to do. */
export function staleProposals(root: string, today: string): Array<string> {
  const out: Array<string> = [];
  for (const p of readProposals(root)) {
    if (typeof p === 'string') {
      continue;
    }
    const age = p.date ? (Date.parse(today) - Date.parse(p.date)) / 864e5 : 0;
    if (p.status === 'proposed' && age > staleDays) {
      out.push(
        `${p.file}: proposed ${Math.floor(age)} days ago with no choice. Ask the owner again, or retire it as historical.`,
      );
    }
    if (p.status === 'adopted' && p.issue && issueStatus(root, p.issue) === 'done') {
      out.push(
        `${p.file}: ${p.issue} is done. Mark the proposal current and delete ${p.prototype ?? 'its prototype'}.`,
      );
    }
  }
  return out;
}

if (import.meta.main) {
  const errors = checkProposals(process.cwd());
  if (errors.length) {
    console.error(
      [
        `Design proposal check failed (${errors.length}).`,
        'See .agents/skills/design-proposal/SKILL.md.',
        '',
        ...errors,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else if (process.argv.includes('--stale')) {
    const stale = staleProposals(process.cwd(), new Date().toISOString().slice(0, 10));
    console.log(stale.length ? stale.join('\n') : 'No design proposal waits too long.');
  } else {
    console.log('Design proposals follow .agents/skills/design-proposal/SKILL.md.');
  }
}
