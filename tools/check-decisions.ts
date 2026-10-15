import { blankFences, readDoc } from '@tools/docs-files';

/**
 * Each record in docs/contributing/decisions/ has a unique four-digit number,
 * and the index lists each record exactly once. The template (0000) is not a
 * record.
 */
const folder = 'docs/contributing/decisions';
const record = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export async function checkDecisions(root: string): Promise<string[]> {
  const errors: string[] = [];
  const files = (
    await Array.fromAsync(new Bun.Glob('*.md').scan({ cwd: `${root}/${folder}` }))
  ).sort();
  const records = files.filter((file) => file !== 'index.md' && file !== '0000-template.md');
  const numbers = new Map<string, string>();
  for (const file of records) {
    const match = record.exec(file);
    if (!match) {
      errors.push(`${folder}/${file}: name a record NNNN-kebab-slug.md.`);
      continue;
    }
    const other = numbers.get(match[1]);
    if (other)
      errors.push(
        `${folder}/${file}: ${match[1]} is also used by ${other}. Renumber the later record.`,
      );
    numbers.set(match[1], file);
  }
  const index = blankFences(await readDoc(root, `${folder}/index.md`));
  const listed = [...index.matchAll(/\]\(\.\/([^)#\s]+\.md)\)/g)]
    .map((match) => match[1])
    .filter((file) => file !== '0000-template.md');
  for (const file of records) {
    const count = listed.filter((link) => link === file).length;
    if (count !== 1)
      errors.push(`${folder}/index.md: lists ${file} ${count} times. List each record once.`);
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
  } else console.log('Decision records have unique numbers, and the index lists each one.');
}
