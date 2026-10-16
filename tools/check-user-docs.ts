import { basename, join } from 'node:path';

/**
 * Each user page in docs/users/ has frontmatter that matches the contract in
 * docs/users/README.md. README.md is the contract, so the check skips it.
 */
const folder = 'docs/users';
const required = ['id', 'title', 'summary', 'type'];
const allowed = new Set([...required, 'audience']);
const types = new Set([
  'intro',
  'getting-started',
  'concept',
  'playbook',
  'integration',
  'reference',
]);

export function findPageErrors(file: string, content: string): string[] {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (!match) return [`${file}: the page has no frontmatter.`];
  let data: unknown;
  try {
    data = Bun.YAML.parse(match[1]);
  } catch (error) {
    return [`${file}: the frontmatter is not valid YAML (${(error as Error).message}).`];
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return [`${file}: the frontmatter is not a map of fields.`];
  const fields = data as Record<string, unknown>;
  const errors: string[] = [];
  for (const field of required)
    if (typeof fields[field] !== 'string' || !(fields[field] as string).trim())
      errors.push(`${file}: \`${field}\` is missing or empty.`);
  for (const field of Object.keys(fields))
    if (!allowed.has(field)) errors.push(`${file}: \`${field}\` is not a frontmatter field.`);
  if (typeof fields.type === 'string' && !types.has(fields.type))
    errors.push(`${file}: \`type: ${fields.type}\` is not one of ${[...types].join(', ')}.`);
  if ('audience' in fields && fields.audience !== 'agents')
    errors.push(`${file}: \`audience\` can only be \`agents\`.`);
  const id = basename(file, '.md').replaceAll('-', '_');
  if (typeof fields.id === 'string' && fields.id !== id)
    errors.push(`${file}: \`id\` is \`${fields.id}\`. The file name gives \`${id}\`.`);
  return errors;
}

export async function checkUserDocs(root: string): Promise<string[]> {
  const errors: string[] = [];
  const owners = new Map<string, string>();
  const files = await Array.fromAsync(new Bun.Glob(`${folder}/*.md`).scan({ cwd: root }));
  for (const file of files.sort()) {
    if (file === `${folder}/README.md`) continue;
    const content = await Bun.file(join(root, file)).text();
    errors.push(...findPageErrors(file, content));
    const id = /^---\n[\s\S]*?^id:\s*(\S+)/m.exec(content)?.[1];
    if (!id) continue;
    const owner = owners.get(id);
    if (owner) errors.push(`${file}: \`id: ${id}\` is also used by ${owner}.`);
    owners.set(id, file);
  }
  return errors;
}

if (import.meta.main) {
  const errors = await checkUserDocs(process.cwd());
  if (errors.length) {
    console.error(
      [
        `User docs check failed (${errors.length}).`,
        'Fix the frontmatter to match the table in docs/users/README.md.',
        '',
        ...errors,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else console.log('Each user page has frontmatter that matches docs/users/README.md.');
}
