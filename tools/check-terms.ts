import { blankFences, listDocs, maskInlineCode, readDoc } from '@tools/docs-files';

/**
 * Rejected words in contributor docs. The list is the "Rejected words" table
 * in the glossary, so the glossary stays the one place that names them. The
 * glossary itself lists the words, so it is skipped.
 */
export const glossary = 'docs/contributing/glossary.md';

export type Term = { word: string; instead: string; pattern: RegExp };
export type Match = { file: string; line: number; column: number; word: string; instead: string };

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/** The rows of the "Rejected words" table: a word in inline code, then what to use instead. */
export function parseTerms(content: string): Array<Term> {
  const section = content.split(/^## /mu).find((part) => part.startsWith('Rejected words\n'));
  const terms: Array<Term> = [];
  for (const line of section?.split('\n') ?? []) {
    const row = /^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*$/u.exec(line);
    if (row) {
      const [, word, instead] = row;
      // A word matches as a whole word. A symbol, such as a dash, matches anywhere.
      const pattern = /\w/u.test(word)
        ? new RegExp(String.raw`(?<![\w-])${escape(word)}(?![\w-])`, 'iu')
        : new RegExp(escape(word), 'u');
      terms.push({ word, instead, pattern });
    }
  }
  return terms;
}

export function findTerms(file: string, content: string, terms: Array<Term>): Array<Match> {
  if (file === glossary) {
    return [];
  }
  const matches: Array<Match> = [];
  const prose = blankFences(content).replaceAll(/<!--[\s\S]*?-->/gu, (comment) =>
    comment.replaceAll(/[^\n]/gu, ' '),
  );
  for (const [index, line] of prose.split('\n').entries()) {
    const text = maskInlineCode(line).replaceAll(/\]\([^)]*\)/gu, (link) =>
      ' '.repeat(link.length),
    );
    for (const { word, instead, pattern } of terms) {
      const match = pattern.exec(text);
      if (match) {
        matches.push({ file, line: index + 1, column: match.index + 1, word, instead });
      }
    }
  }
  return matches;
}

export async function checkTerms(root: string): Promise<Array<string>> {
  const terms = parseTerms(await readDoc(root, glossary));
  if (!terms.length) {
    return [`${glossary}: the "Rejected words" table is missing or empty. Restore it.`];
  }
  const problems: Array<string> = [];
  for (const file of await listDocs(root)) {
    for (const m of findTerms(file, await readDoc(root, file), terms)) {
      problems.push(`${m.file}:${m.line}:${m.column}: \`${m.word}\`. Use ${m.instead}.`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const problems = await checkTerms(process.cwd());
  if (problems.length) {
    console.error(
      [
        `Glossary terms check failed (${problems.length}).`,
        `Use one word for one idea. See ${glossary}#rejected-words.`,
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Contributor docs use the glossary terms.');
  }
}
