import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  applies,
  formProblems,
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

describe('the real review page', () => {
  test('gives each rule a readable Trigger: line and a Because: line', () => {
    expect(parsePage(realPage).rules.length).toBeGreaterThanOrEqual(14);
    expect(formProblems(realPage)).toEqual([]);
  });

  test('fails the form when one rule loses its Trigger: or Because: line', () => {
    const noTrigger = realPage.replace(/^ {2}Trigger: files `\*\*\/\*fingerprint\*`\.$/mu, '');
    const noBecause = realPage.replace(/^ {2}Because: \[test the workflow\].*$/mu, '');
    expect(noTrigger).not.toBe(realPage);
    expect(noBecause).not.toBe(realPage);
    expect(formProblems(noTrigger)).toEqual([
      'A changed native fingerprint with no native change has no Trigger: line',
    ]);
    expect(formProblems(noBecause)).toEqual(['An untyped fake has no Because: line']);
  });

  test('fails the form for a section with no rule item and for prose after the rules', () => {
    const noItem = realPage.replace(
      '## Add or remove a rule',
      '## Speed\n\nFlag a slow loop.\n\n$&',
    );
    expect(formProblems(noItem)).toEqual(['Speed has no rule item']);
    const after = realPage.replace('## Tests', 'Flag a new sleep in a test.\n\n$&');
    expect(formProblems(after)).toEqual([
      'prose after the rules is dropped: Principles that no check holds: Flag a new sleep in a test.',
    ]);
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

/** Each rule, and diffs that it must match: a path, or a path and an added line after `: `. */
const widened: Record<string, Array<string>> = {
  'A weaker or deleted test': [
    'f/journeys/a.journey.ts',
    'a/__snapshots__/a.snap',
    'f/__screenshots__/a.png',
  ],
  'A second door': ['.github/workflows/deploy.yml', 'factory/jobs/sync.ts'],
  'A layout for one width': ['p/a.ts: "lg:flex-row"', 'p/a.ts: @media (width > 40rem)', 'p/a.scss'],
  'Keyboard first': ['p/keys.ts: if (event.key === "k")'],
  'A delete with no name guard': [
    'scripts/a.ts: purge(name)',
    'a/x.ts: api.remove(id)',
    'p/x.ts: DROP TABLE a',
  ],
  'An untyped fake': ['p/StripeFake.ts', 'p/__mocks__/stripe.ts', 'p/mail-stub.ts'],
  'A new escape hatch': ['a/x.ts: // nolint: unused'],
  'A changed native fingerprint with no native change': ['apps/app/fingerprint.config.cjs'],
  'A server render': ['packages/ui/vite.config.ts'],
  'Fix the root bottleneck': ['a/x.ts: const ttl = 60'],
  'A changed guardrail file': ['.github/workflows/ci.yml'],
};

describe('the widened triggers', () => {
  for (const [rule, changes] of Object.entries(widened)) {
    for (const change of changes) {
      test(`${rule}: ${change}`, () => {
        const [file = '', line] = change.split(': ');
        const diff = diffOf([{ file, lines: line === undefined ? undefined : [`+${line}`] }]);
        expect(namesFor(diff)).toContain(rule);
      });
    }
  }
});

/** The run script of a step of agent-review.yml: the indented block under its `run: |`. */
const stepScript = (name: string) => {
  const lines = read('.github/workflows/agent-review.yml').split('\n');
  const start = lines.findIndex(
    (line, at) =>
      line.trim() === 'run: |' && lines.slice(0, at).some((l) => l.includes(`name: ${name}`)),
  );
  const body = lines.slice(start + 1);
  const indent = /^ */u.exec(body[0] ?? '')?.[0] ?? '';
  const end = body.findIndex((line) => line.trim() && !line.startsWith(indent));
  return body
    .slice(0, end)
    .map((line) => line.slice(indent.length))
    .join('\n');
};

/**
 * A checkout whose bunfig.toml preload writes a marker, the tool folder that the
 * step before prepares, and a `mise` that only runs its command.
 */
const setUp = (withPage: boolean) => {
  const base = mkdtempSync(path.join(tmpdir(), 'review-rules-'));
  const at = (...parts: Array<string>) => path.join(base, ...parts);
  for (const dir of ['checkout/docs/contributing', 'checkout/tools', 'tools', 'bin']) {
    mkdirSync(at(dir), { recursive: true });
  }
  const files: Record<string, string> = {
    'checkout/bunfig.toml': 'preload = ["./pr-code.ts"]\n',
    'checkout/pr-code.ts': `require('node:fs').writeFileSync(${JSON.stringify(at('ran'))}, '');\n`,
    'checkout/tools/guardrail-files.json': read('tools/guardrail-files.json'),
    'tools/review-rules.ts': read('tools/github/review-rules.ts'),
    'tools/bunfig.toml': '',
    'bin/mise': '#!/bin/sh\n[ "$1" = exec ] && shift && [ "$1" = -- ] && shift\nexec "$@"\n',
    'pr.diff': diffOf([{ file: 'oxlint.config.ts' }]),
    ...(withPage ? { [`checkout/${reviewPage}`]: realPage } : {}),
  };
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(at(file), content);
  }
  chmodSync(at('bin/mise'), 0o755);
  const env = {
    PATH: `${at('bin')}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: base,
    RUNNER_TEMP: base,
    TOOLS: at('tools'),
  };
  const script = stepScript('Select the review rules');
  return {
    at,
    step: () =>
      Bun.spawnSync(['bash', '--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
        cwd: at('checkout'),
        env,
      }),
    inCheckout: () =>
      Bun.spawnSync(['bun', at('tools/review-rules.ts'), at('pr.diff')], {
        cwd: at('checkout'),
        env,
      }),
    output: () => readFileSync(at('review-rules.md'), 'utf-8'),
  };
};

describe('the workflow step that selects the rules', () => {
  test('runs the tool outside the checkout, so the PR bunfig.toml preload does not run', () => {
    const { at, step, inCheckout, output } = setUp(true);
    expect(step().exitCode).toBe(0);
    expect(output()).toContain('rules of docs/contributing/review.md match this diff');
    expect(output()).toContain('- **A changed guardrail file.**');
    expect(existsSync(at('ran'))).toBe(false);
    // The control: with the checkout as the current folder, Bun runs the preload.
    inCheckout();
    expect(existsSync(at('ran'))).toBe(true);
  });

  test('falls back to every rule when the page cannot be read', () => {
    const { step, output } = setUp(false);
    const run = step();
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toContain('::notice title=Every review rule applies::');
    expect(output()).toBe('Apply every rule of docs/contributing/review.md.\n');
  });
});
