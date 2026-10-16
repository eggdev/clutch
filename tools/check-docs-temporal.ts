import { blankFences, listDocs, maskInlineCode, readDoc } from '@tools/docs-files';

/**
 * Changelog phrases in durable docs. Keep the list narrow, and in line with
 * docs/contributing/documentation.md. Decision records are point-in-time, so
 * they are skipped. The documentation page quotes the phrases, so it is skipped.
 */
const skipped = (file: string) =>
  file.startsWith('docs/contributing/decisions/') || file === 'docs/contributing/documentation.md';

export const phrases: Array<[label: string, pattern: RegExp]> = [
  ['now we', /\bnow we\b/iu],
  ['we now', /\bwe now\b/iu],
  ['we no longer', /\bwe no longer\b/iu],
  ['previously we, previously a', /\bpreviously (?:we|a|an|the)\b/iu],
  ['formerly we', /\bformerly we\b/iu],
  ['as before', /\bas before\b/iu],
  ['was or were removed', /\b(?:was|were)\s+removed\b/iu],
  ['was or were retired', /\b(?:was|were)\s+retired\b/iu],
  ['no longer', /\bno longer\b/iu],
  ['is now, are now', /\b(?:is|are) now\b/iu],
  [
    'now plus a verb',
    /\bnow (?:supports?|accepts?|requires?|uses?|stores?|returns?|calls?|reads?|runs?|connects?|serves?|has|have|lives?)\b/iu,
  ],
  ['recently', /\brecently (?:changed|added|updated|removed|introduced|moved)\b/iu],
  ['used to', /\bused to (?:support|require|be)\b/iu],
  ['does not exist yet', /\b(?:does not|do not|doesn't|don't) exist yet\b/iu],
];

export type Match = { file: string; line: number; column: number; label: string; text: string };

export function findPhrases(file: string, content: string): Array<Match> {
  if (skipped(file)) {
    return [];
  }
  const matches: Array<Match> = [];
  for (const [index, line] of blankFences(content).split('\n').entries()) {
    const prose = maskInlineCode(line);
    for (const [label, pattern] of phrases) {
      const match = pattern.exec(prose);
      if (match) {
        matches.push({ file, line: index + 1, column: match.index + 1, label, text: line.trim() });
      }
    }
  }
  return matches;
}

export async function checkDocsTemporal(root: string): Promise<Array<Match>> {
  const matches: Array<Match> = [];
  for (const file of await listDocs(root)) {
    matches.push(...findPhrases(file, await readDoc(root, file)));
  }
  return matches;
}

if (import.meta.main) {
  const matches = await checkDocsTemporal(process.cwd());
  if (matches.length) {
    console.error(
      [
        `Docs temporal language check failed (${matches.length}).`,
        'Describe how the system works, not how it changed. Keep status in the issue tracker.',
        'See docs/contributing/documentation.md.',
        '',
        ...matches.map((m) => `${m.file}:${m.line}:${m.column} (${m.label}): ${m.text}`),
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Docs describe the system without changelog phrases.');
  }
}
