import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { guardrailList } from '@tools/agent-hooks/guard-guardrails';

/**
 * Each file that a check, a lint plugin or a hook reads must be a guardrail
 * file, so a person reviews each change to it. The list of files read is not
 * written by hand. This check finds the tool scripts that the root targets,
 * the lint config and the hook configs run, follows their `@tools/` imports,
 * and keeps each static path in them that names a file here. See
 * docs/contributing/harness-engineering.md#guardrail-files.
 */
const entryConfigs = ['package.json', 'oxlint.config.ts', 'stylelint.config.ts'];
const hookConfigs = ['.claude/settings.json', '.codex/hooks.json'];
const toolScript = /\btools\/[\w./-]+\.(?:ts|mjs)\b/gu;
const hookScript = /\.agents\/hooks\/[\w-]+\.ts\b/gu;
const toolImport = /\bfrom\s+['"]@tools\/([^'"]+)['"]/gu;
const literal = /(['"`])([^'"`\s${}*?]+)\1/gu;

type GuardrailList = { patterns: Array<string>; exempt?: Record<string, string> };

const isFile = (root: string, file: string) =>
  existsSync(path.join(root, file)) && statSync(path.join(root, file)).isFile();

/** The script that an `@tools/...` import names. */
function importTarget(root: string, specifier: string): string | null {
  const base = `tools/${specifier}`;
  for (const candidate of [base, `${base}.ts`, `${base}.mjs`]) {
    if (/\.[cm]?[jt]s$/u.test(candidate) && isFile(root, candidate)) {
      return candidate;
    }
  }
  return null;
}

/** The tool scripts that targets, the lint config and the agent hooks run. */
export function entryScripts(root: string): Array<string> {
  const scripts = new Set<string>();
  for (const config of [...entryConfigs, ...hookConfigs].filter((file) => isFile(root, file))) {
    const text = readFileSync(path.join(root, config), 'utf-8');
    for (const match of [...text.matchAll(toolScript), ...text.matchAll(hookScript)]) {
      if (isFile(root, match[0])) {
        scripts.add(match[0]);
      }
    }
  }
  return [...scripts].toSorted();
}

/** Each file that the entry scripts read, with the scripts that read it. */
export function filesRead(root: string): Map<string, Set<string>> {
  const read = new Map<string, Set<string>>();
  const note = (file: string, by: string) => {
    if (!file.startsWith('node_modules/')) {
      read.set(file, (read.get(file) ?? new Set()).add(by));
    }
  };
  const queue = entryScripts(root);
  for (const script of queue) {
    note(script, 'a target, the lint config or an agent hook');
  }
  const seen = new Set<string>();
  for (let script = queue.shift(); script; script = queue.shift()) {
    if (seen.has(script)) {
      continue;
    }
    seen.add(script);
    const text = readFileSync(path.join(root, script), 'utf-8');
    for (const [, specifier] of text.matchAll(toolImport)) {
      const target = importTarget(root, specifier);
      if (target) {
        note(target, script);
        queue.push(target);
      }
    }
    for (const match of text.matchAll(literal)) {
      const value = match[2];
      if (value.length > 2 && value.includes('.') && isFile(root, value)) {
        note(value, script);
      }
    }
  }
  return read;
}

export function checkGuardrailCoverage(root: string): Array<string> {
  const list: GuardrailList = JSON.parse(readFileSync(path.join(root, guardrailList), 'utf-8'));
  const globs = list.patterns.map((pattern) => new Bun.Glob(pattern));
  const exempt = list.exempt ?? {};
  const problems: Array<string> = [];
  for (const [file, reason] of Object.entries(exempt)) {
    if (!reason.trim()) {
      problems.push(`${guardrailList}: \`exempt.${file}\` has no reason. Say why it sets no rule.`);
    }
  }
  for (const [file, readers] of [...filesRead(root)].toSorted(([a], [b]) => a.localeCompare(b))) {
    if (Object.hasOwn(exempt, file) || globs.some((glob) => glob.match(file))) {
      continue;
    }
    const by = [...readers].toSorted().join(', ');
    problems.push(
      `${file}: ${by} reads it, but no guardrail pattern covers it. Add a pattern to ${guardrailList} and .github/CODEOWNERS, or list it under \`exempt\` with a reason if it sets no rule.`,
    );
  }
  return problems;
}

if (import.meta.main) {
  const problems = checkGuardrailCoverage(process.cwd());
  if (problems.length) {
    console.error(
      [
        `Guardrail coverage check failed (${problems.length}).`,
        'A file that a check, a lint plugin or a hook reads needs a person to review its changes.',
        'See docs/contributing/harness-engineering.md#guardrail-files.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log(
      'A guardrail pattern covers each file that a check, a lint plugin or a hook reads.',
    );
  }
}
