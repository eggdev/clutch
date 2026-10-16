import path from 'node:path';

/** Contributor docs, as docs/contributing/documentation.md lists them. Paths are repo-relative. */
export async function listDocs(root: string): Promise<Array<string>> {
  const files = new Set<string>();
  for (const pattern of [
    'AGENTS.md',
    'KICKOFF.md',
    'README.md',
    'apps/*/README.md',
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
