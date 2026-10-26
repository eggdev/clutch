import { blankFences, readDoc } from '@tools/docs-files';

/**
 * Rules for docs/contributing/decisions/. The template (0000) is not a record.
 *
 * - Each record has a unique four-digit number and a kebab-case slug.
 * - The status is `accepted`, `superseded by [NNNN](./NNNN-slug.md)` or
 *   `amended by` one or more such links. Each link names a later record.
 * - The Consequences section has a `**Revisit if:**` line with a condition.
 * - A record has at most 500 words. A longer one is an architecture page.
 * - The index lists each record once: a superseded record under "Historical",
 *   every other record under "Steering list".
 */
const folder = 'docs/contributing/decisions';
const record = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;
const link = /\[(\d{4})\]\(\.\/((\d{4})-[a-z0-9-]+\.md)\)/gu;
export const wordLimit = 500;

type Status = { kind: 'accepted' | 'superseded' | 'amended'; targets: Array<string> } | null;

export function parseStatus(content: string): Status {
  const line = /^- \*\*Status:\*\* (.+)$/mu
    .exec(content)?.[1]
    .replaceAll(/<!--.*?-->/gu, '')
    .trim();
  if (!line) {
    return null;
  }
  if (line === 'accepted') {
    return { kind: 'accepted', targets: [] };
  }
  const match = /^(superseded|amended) by (.+)$/u.exec(line);
  if (!match) {
    return null;
  }
  const targets = [...match[2].matchAll(link)].map((found) => found[2]);
  const rest = match[2].replaceAll(link, '').replaceAll(/[\s,]|and/gu, '');
  if (!targets.length || rest || (match[1] === 'superseded' && targets.length > 1)) {
    return null;
  }
  return { kind: match[1] as 'superseded' | 'amended', targets };
}

const words = (content: string) =>
  blankFences(content)
    .replaceAll(/<!--[\s\S]*?-->/gu, '')
    .split(/\s+/u)
    .filter(Boolean).length;

/** The index text under one H2, up to the next H2. */
const section = (index: string, title: string) =>
  index.split(/^## /mu).find((part) => part.startsWith(`${title}\n`)) ?? '';

const linksIn = (text: string) =>
  [...text.matchAll(/\]\(\.\/([^)#\s]+\.md)\)/gu)]
    .map((match) => match[1])
    .filter((file) => file !== '0000-template.md');

export async function checkDecisions(root: string): Promise<Array<string>> {
  const errors: Array<string> = [];
  const scanned = await Array.fromAsync(new Bun.Glob('*.md').scan({ cwd: `${root}/${folder}` }));
  const files = scanned.toSorted();
  const records = files.filter((file) => file !== 'index.md' && file !== '0000-template.md');
  const numbers = new Map<string, string>();
  const statuses = new Map<string, Status>();
  for (const file of records) {
    const match = record.exec(file);
    if (!match) {
      errors.push(`${folder}/${file}: name a record NNNN-kebab-slug.md.`);
      continue;
    }
    const other = numbers.get(match[1]);
    if (other) {
      errors.push(
        `${folder}/${file}: ${match[1]} is also used by ${other}. Renumber the later record.`,
      );
    }
    numbers.set(match[1], file);
    const content = await readDoc(root, `${folder}/${file}`);
    const status = parseStatus(content);
    statuses.set(file, status);
    if (!status) {
      errors.push(
        `${folder}/${file}: the status must be "accepted", "superseded by [NNNN](./NNNN-slug.md)" or "amended by [NNNN](./NNNN-slug.md)".`,
      );
    }
    for (const target of status?.targets ?? []) {
      if (!records.includes(target)) {
        errors.push(`${folder}/${file}: the status links ${target}, which does not exist.`);
      } else if (target.slice(0, 4) <= match[1]) {
        errors.push(`${folder}/${file}: the status links ${target}. It must name a later record.`);
      }
    }
    if (!/^\*\*Revisit if:\*\*[ \t]*\S/mu.test(blankFences(content))) {
      errors.push(
        `${folder}/${file}: add a "**Revisit if:**" line with the condition that reopens the decision.`,
      );
    }
    const count = words(content);
    if (count > wordLimit) {
      errors.push(
        `${folder}/${file}: ${count} words, limit ${wordLimit}. Split it into two decisions, or move the design to an architecture page.`,
      );
    }
  }
  const index = blankFences(await readDoc(root, `${folder}/index.md`));
  const listed = linksIn(index);
  const steering = linksIn(section(index, 'Steering list'));
  const historical = linksIn(section(index, 'Historical'));
  for (const file of records) {
    const count = listed.filter((found) => found === file).length;
    if (count !== 1) {
      errors.push(`${folder}/index.md: lists ${file} ${count} times. List each record once.`);
      continue;
    }
    const superseded = statuses.get(file)?.kind === 'superseded';
    if (superseded && !historical.includes(file)) {
      errors.push(`${folder}/index.md: ${file} is superseded. List it under "Historical".`);
    }
    if (!superseded && !steering.includes(file)) {
      errors.push(`${folder}/index.md: ${file} is in force. List it under "Steering list".`);
    }
  }
  return errors;
}

if (import.meta.main) {
  const errors = await checkDecisions(process.cwd());
  if (errors.length) {
    console.error(
      [
        `Decision record check failed (${errors.length}).`,
        'See docs/contributing/decisions/index.md.',
        '',
        ...errors,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Decision records follow the rules in docs/contributing/decisions/index.md.');
  }
}
