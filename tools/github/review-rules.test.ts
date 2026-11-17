import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  applies,
  parseDiff,
  parsePage,
  parseTrigger,
  reviewPage,
  selectRules,
} from '@tools/github/review-rules';

const root = path.resolve(import.meta.dir, '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf-8');
const realPage = read(reviewPage);

const diffOf = (changes: Array<{ file: string; lines?: Array<string>; deleted?: boolean }>) =>
  changes
    .map(({ file, lines = ['+x'], deleted }) =>
      [
        `diff --git a/${file} b/${file}`,
        ...(deleted ? ['deleted file mode 100644'] : []),
        `--- a/${file}`,
        deleted ? '+++ /dev/null' : `+++ b/${file}`,
        '@@ -1 +1 @@',
        ...lines,
      ].join('\n'),
    )
    .join('\n');

const namesFor = (diff: string) => {
  const parsed = parseDiff(diff);
  return parsePage(realPage)
    .rules.filter((rule) => applies(rule.trigger, parsed, read))
    .map((rule) => rule.name);
};

/** The form problems of a page: each rule with no `Trigger:`, no `Because:` or an unreadable trigger. */
const formProblems = (content: string) =>
  parsePage(content).rules.flatMap((rule) => [
    ...(rule.hasTrigger ? [] : [`${rule.name} has no Trigger: line`]),
    ...(rule.hasBecause ? [] : [`${rule.name} has no Because: line`]),
    ...(rule.hasTrigger && rule.trigger.kind === 'unreadable'
      ? [`${rule.name} has an unreadable trigger`]
      : []),
  ]);

describe('the real review page', () => {
  test('gives each rule a readable Trigger: line and a Because: line', () => {
    expect(parsePage(realPage).rules.length).toBeGreaterThanOrEqual(14);
    expect(formProblems(realPage)).toEqual([]);
  });

  test('fails the form when one rule loses its Trigger: or Because: line', () => {
    const noTrigger = realPage.replace(
      /^ {2}Trigger: files `\*\*\/native-fingerprint\.json`\.$/mu,
      '',
    );
    const noBecause = realPage.replace(/^ {2}Because: \[test the workflow\].*$/mu, '');
    expect(noTrigger).not.toBe(realPage);
    expect(noBecause).not.toBe(realPage);
    expect(formProblems(noTrigger)).toEqual([
      'A changed native fingerprint with no native change has no Trigger: line',
    ]);
    expect(formProblems(noBecause)).toEqual(['An untyped fake has no Because: line']);
  });

  test('a docs-only diff triggers only the rules that match docs', () => {
    expect(namesFor(diffOf([{ file: 'docs/contributing/setup/index.md' }]))).toEqual([
      'A weaker check',
      'A hard invariant',
    ]);
  });

  test('a deleted test file triggers the rule about a weaker or deleted test', () => {
    const names = namesFor(
      diffOf([{ file: 'tools/foo.test.ts', lines: ['-test()'], deleted: true }]),
    );
    expect(names).toContain('A weaker or deleted test');
  });

  test('a guardrail file triggers its rule through the listed patterns', () => {
    expect(namesFor(diffOf([{ file: 'oxlint.config.ts' }]))).toContain('A changed guardrail file');
  });

  test('prints the finding levels and the matched rules for the reviewer', () => {
    const out = selectRules(realPage, parseDiff(diffOf([{ file: 'docs/a.md' }])), read);
    expect(out).toContain('## Finding levels');
    expect(out).toContain('## Owner findings');
    expect(out).toContain('- **A weaker check**');
    expect(out).not.toContain('- **Keyboard first.**');
    expect(out).toContain('Not triggered by this diff:');
  });
});

describe('parseTrigger', () => {
  test('reads each group form', () => {
    expect(parseTrigger('each pull request. Any file.')).toEqual({ kind: 'always' });
    expect(parseTrigger('files `a/**`, `*.md`; lines `foo`. A note.')).toEqual({
      kind: 'groups',
      groups: [
        { kind: 'files', globs: ['a/**', '*.md'], lines: undefined },
        { kind: 'lines', lines: ['foo'] },
      ],
    });
    expect(parseTrigger('files except `**/*.md` with lines `a.b`.')).toEqual({
      kind: 'groups',
      groups: [{ kind: 'except', globs: ['**/*.md'], lines: ['a.b'] }],
    });
    expect(parseTrigger('files listed in `x.json`.')).toEqual({
      kind: 'groups',
      groups: [{ kind: 'listed', file: 'x.json', lines: undefined }],
    });
  });

  test('marks a trigger it cannot read, which then applies always', () => {
    const texts = ['some paths', 'files a/**.', 'files `a`; lines.', 'lines `a` with lines `b`.'];
    for (const text of texts) {
      const trigger = parseTrigger(text);
      expect(trigger).toEqual({ kind: 'unreadable' });
      expect(applies(trigger, { files: [], lines: [] }, read)).toBe(true);
    }
  });
});

describe('applies', () => {
  const diff = parseDiff(
    diffOf([
      { file: 'docs/a.md', lines: ['+add a timeout'] },
      { file: 'src/b.ts', lines: ['-const x = 1'] },
    ]),
  );

  test('matches files, files except, lines in matching files, and an unreadable list', () => {
    expect(diff.files).toEqual(['docs/a.md', 'src/b.ts']);
    expect(applies(parseTrigger('files `src/**`.'), diff, read)).toBe(true);
    expect(applies(parseTrigger('files `apps/**`.'), diff, read)).toBe(false);
    expect(applies(parseTrigger('files except `**/*.md`, `src/**`.'), diff, read)).toBe(false);
    expect(applies(parseTrigger('files except `**/*.md` with lines `TIMEOUT`.'), diff, read)).toBe(
      false,
    );
    expect(applies(parseTrigger('files `**/*.md` with lines `TIMEOUT`.'), diff, read)).toBe(true);
    expect(applies(parseTrigger('files listed in `no-such.json`.'), diff, read)).toBe(true);
  });

  test('takes the old path of a renamed file', () => {
    const renamed = parseDiff('diff --git a/x.test.ts b/y.ts\nrename from x.test.ts\n');
    expect(renamed.files.toSorted()).toEqual(['x.test.ts', 'y.ts']);
  });
});
