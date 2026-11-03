/**
 * Prints `path:count` for each file that breaks one lint rule, for a command
 * ratchet in `.clutch/ratchets.json`. It sets `REPO_LINT_ALL=1`, so a rule that
 * skips its ratcheted files counts them too.
 *
 *   bun tools/lint/lint-counts.ts repo-components/design-system-only [paths...]
 *
 * See docs/contributing/setup/lint-rules.md#ratchet-a-rule.
 */
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../..');

type Diagnostic = { code: string; filename: string };

/** The oxlint code of a rule, such as `repo-components(design-system-only)`. */
export function ruleCode(rule: string) {
  const [plugin, name] = rule.split('/');
  return name ? `${plugin}(${name})` : rule;
}

/** Counts the diagnostics of `rule` in each file, as `path:count` lines sorted by path. */
export function countLines(diagnostics: Array<Diagnostic>, rule: string) {
  const counts = new Map<string, number>();
  const code = ruleCode(rule);
  for (const item of diagnostics) {
    if (item.code === code) {
      const file = path.relative(root, path.resolve(root, item.filename)).split(path.sep).join('/');
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
  }
  return [...counts]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([file, count]) => `${file}:${count}`);
}

if (import.meta.main) {
  const [rule, ...paths] = process.argv.slice(2);
  if (!rule) {
    console.error('Usage: bun tools/lint/lint-counts.ts <plugin/rule> [paths...]');
    process.exit(2);
  }
  const run = Bun.spawnSync(
    [
      path.join(root, 'node_modules/.bin/oxlint'),
      '-c',
      path.join(root, 'oxlint.config.ts'),
      '--format',
      'json',
      ...(paths.length > 0 ? paths : ['apps', 'features', 'packages']),
    ],
    { cwd: root, env: { ...process.env, REPO_LINT_ALL: '1' } },
  );
  const output = run.stdout.toString();
  if (!output.trim().startsWith('{')) {
    console.error(run.stderr.toString() || output);
    process.exit(2);
  }
  const lines = countLines(JSON.parse(output).diagnostics, rule);
  if (lines.length > 0) {
    console.log(lines.join('\n'));
  }
}
