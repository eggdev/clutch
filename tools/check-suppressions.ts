import path from 'node:path';

/**
 * Suppression comments. A lint or type rule is on everywhere or off
 * everywhere (docs/contributing/setup/lint-rules.md), so no file may silence
 * one. A Semgrep false positive may be silenced on its line when the comment
 * names the rule and a reason: `nosemgrep: rule-id -- reason`. The directive
 * names are joined from parts, so this file does not match itself.
 */
const sources = '{apps,features,packages,tools}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,css}';
const rootFiles = '*.{ts,mts,js,mjs,cjs,css}';
/** Semgrep also reads scripts and workflows. */
const scripts = '{apps,features,packages,tools,.agents,.github}/**/*.{py,sh,yml,yaml}';

export const directives: Array<[label: string, fix: string, pattern: RegExp]> = [
  [
    'lint disable',
    'Fix the code. If the rule is wrong for the repository, configure it or turn it off in its config file, with the reason.',
    new RegExp(String.raw`(?:\/\/|\/\*)\s*(?:eslint|oxlint|stylelint)-${'disable'}`, 'u'),
  ],
  [
    'biome ignore',
    'Fix the code. If the rule is wrong for the repository, configure it or turn it off in its config file, with the reason.',
    new RegExp(String.raw`(?:\/\/|\/\*)\s*biome-${'ignore'}`, 'u'),
  ],
  [
    'type check suppression',
    'Fix the type. For a value from outside the program, decode it with a schema.',
    new RegExp(String.raw`(?:\/\/|\/\*)\s*@ts-(?:${'ignore'}|expect-${'error'}|${'nocheck'})`, 'u'),
  ],
  [
    'semgrep suppression without a reason',
    'Fix the code. For a false positive, name the rule and the reason: nosemgrep: rule-id -- reason.',
    new RegExp(
      String.raw`(?:\/\/|\/\*|#)\s*${'no'}sem(?:grep)?\b(?!:\s*[\w.-]+(?:\s*,\s*[\w.-]+)*\s+--\s+\S)`,
      'u',
    ),
  ],
];

export type Match = { file: string; line: number; label: string; fix: string };

/** The suppression comments in one file's text. */
export function findSuppressions(file: string, content: string): Array<Match> {
  const matches: Array<Match> = [];
  for (const [index, line] of content.split('\n').entries()) {
    for (const [label, fix, pattern] of directives) {
      if (pattern.test(line)) {
        matches.push({ file, line: index + 1, label, fix });
      }
    }
  }
  return matches;
}

export async function checkSuppressions(root: string): Promise<Array<Match>> {
  const matches: Array<Match> = [];
  for (const pattern of [sources, rootFiles, scripts]) {
    for await (const file of new Bun.Glob(pattern).scan({ cwd: root, dot: true })) {
      if (!file.split('/').includes('node_modules')) {
        matches.push(...findSuppressions(file, await Bun.file(path.join(root, file)).text()));
      }
    }
  }
  return matches.toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

if (import.meta.main) {
  const matches = await checkSuppressions(process.cwd());
  if (matches.length) {
    console.error(
      [
        `Suppression comment check failed (${matches.length}).`,
        'A rule is on everywhere or off everywhere. Remove each comment and fix the cause.',
        'See docs/contributing/setup/lint-rules.md#how-a-rule-is-chosen.',
        '',
        ...matches.map((m) => `${m.file}:${m.line} (${m.label}): ${m.fix}`),
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('No file suppresses a lint or type rule.');
  }
}
