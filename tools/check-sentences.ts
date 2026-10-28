import { blankFences, listDocs, readDoc } from '@tools/docs-files';

/**
 * Sentences in `docs/` have 25 words or fewer, as Simplified Technical English
 * asks. Skills, kickoff and the agent index are exempt. Decision records are
 * point-in-time, so they are skipped. See docs/contributing/glossary.md#writing.
 */
export const wordLimit = 25;
const checked = (file: string) =>
  file.startsWith('docs/') && !file.startsWith('docs/contributing/decisions/');

type Unit = { line: number; text: string };

/** The same text with each character but a newline turned into a space. */
const blank = (text: string) => text.replaceAll(/[^\n]/gu, ' ');

/** Blanks the frontmatter and HTML comments, and keeps line numbers. */
function blankMeta(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n/u, blank).replaceAll(/<!--[\s\S]*?-->/gu, blank);
}

/** The prose units of a page: each paragraph, list item and table cell, with its first line. */
function unitsOf(content: string): Array<Unit> {
  const units: Array<Unit> = [];
  let current: Unit | null = null;
  const close = () => {
    if (current) {
      units.push(current);
    }
    current = null;
  };
  for (const [index, raw] of blankMeta(blankFences(content)).split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      close();
    } else if (line.startsWith('|')) {
      close();
      for (const cell of line.split('|')) {
        if (cell.trim() && !/^[\s:-]+$/u.test(cell)) {
          units.push({ line: index + 1, text: cell });
        }
      }
    } else if (/^(?:[-*+]|\d+\.)\s/u.test(line) || !current) {
      close();
      current = { line: index + 1, text: line };
    } else {
      current.text += ` ${line}`;
    }
  }
  close();
  return units;
}

/** The words of a sentence. Inline code counts as one word, and a link as its text. */
export function countWords(sentence: string): number {
  const prose = sentence
    .replaceAll(/`[^`]*`/gu, 'code')
    .replaceAll(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1');
  return prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}

/** Each sentence over the limit in one page, with its line. */
export function findLongSentences(file: string, content: string): Array<string> {
  if (!checked(file)) {
    return [];
  }
  const problems: Array<string> = [];
  for (const unit of unitsOf(content)) {
    const sentences = unit.text
      .replace(/^(?:[-*+]|\d+\.)\s+/u, '')
      .split(/(?<=[.!?][*_`)"]*)\s+(?=[^\p{Ll}\s])/u);
    for (const sentence of sentences) {
      const words = countWords(sentence);
      if (words > wordLimit) {
        const start = sentence.slice(0, 60).trim();
        problems.push(`${file}:${unit.line}: ${words} words, "${start}…"`);
      }
    }
  }
  return problems;
}

export async function checkSentences(root: string): Promise<Array<string>> {
  const problems: Array<string> = [];
  for (const file of await listDocs(root)) {
    problems.push(...findLongSentences(file, await readDoc(root, file)));
  }
  return problems;
}

if (import.meta.main) {
  const problems = await checkSentences(process.cwd());
  if (problems.length) {
    console.error(
      [
        `Sentence length check failed (${problems.length}).`,
        `Split each sentence into sentences of ${wordLimit} words or fewer. Keep every fact, number and condition. See docs/contributing/glossary.md#writing.`,
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log(`Each sentence in docs/ has ${wordLimit} words or fewer.`);
  }
}
