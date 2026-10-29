import path from 'node:path';

/** Contributor docs, as docs/contributing/documentation.md lists them. Paths are repo-relative. */
export async function listDocs(root: string): Promise<Array<string>> {
  const files = new Set<string>();
  for (const pattern of [
    'AGENTS.md',
    'KICKOFF.md',
    'README.md',
    'apps/*/README.md',
    'features/*/README.md',
    'packages/*/README.md',
    'docs/**/*.md',
    '.agents/skills/**/*.md',
  ]) {
    for await (const file of new Bun.Glob(pattern).scan({ cwd: root, dot: true })) {
      if (!file.split('/').includes('node_modules')) {
        files.add(file);
      }
    }
  }
  return [...files].toSorted();
}

export const readDoc = (root: string, file: string) => Bun.file(path.join(root, file)).text();

/**
 * Blanks fenced code blocks and keeps line numbers. A closing fence uses the
 * opening character and is at least as long, as in CommonMark.
 */
export function blankFences(content: string): string {
  let open: { character: string; length: number } | null = null;
  return content
    .split('\n')
    .map((line) => {
      const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      if (open) {
        if (
          fence &&
          fence[1][0] === open.character &&
          fence[1].length >= open.length &&
          !fence[2].trim()
        ) {
          open = null;
        }
        return '';
      }
      if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
        open = { character: fence[1][0], length: fence[1].length };
        return '';
      }
      return line;
    })
    .join('\n');
}

/** Replaces each inline code span with spaces, so columns stay the same. */
export const maskInlineCode = (line: string) =>
  line.replaceAll(/(`+)(?:(?!\1)[\s\S])*?\1/gu, (span) => ' '.repeat(span.length));

export type Unit = { line: number; text: string };

/** The same text with each character but a newline turned into a space. */
const blank = (text: string) => text.replaceAll(/[^\n]/gu, ' ');

/** Blanks the frontmatter and HTML comments, and keeps line numbers. */
function blankMeta(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n/u, blank).replaceAll(/<!--[\s\S]*?-->/gu, blank);
}

/** The prose units of a page: each paragraph, list item and table cell, with its first line. */
export function unitsOf(content: string): Array<Unit> {
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
