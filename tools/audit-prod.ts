import path from 'node:path';

import { parse } from 'yaml';

/**
 * The production audit. `bun audit --prod` lists advisories. This check fails
 * on each moderate or worse advisory that tools/accepted-advisories.yaml does
 * not accept, and on each accepted entry that the audit no longer reports. See
 * docs/contributing/setup/dependencies.md#production-audit.
 */
export const acceptedFile = 'tools/accepted-advisories.yaml';
const reported = new Set(['moderate', 'high', 'critical']);

type Advisory = { url: string; title: string; severity: string; vulnerable_versions: string };
export type Report = Record<string, Array<Advisory>>;
export type Accepted = { id?: string; package?: string; reason?: string; revisit?: string };

const ghsaOf = (advisory: Advisory) => advisory.url.match(/GHSA(?:-[a-z0-9]{4}){3}/u)?.[0] ?? '';

/** The problems with the accepted list, then with the audit report. */
export function auditProblems(report: Report, accepted: Array<Accepted>): Array<string> {
  const problems: Array<string> = [];
  for (const [index, entry] of accepted.entries()) {
    for (const field of ['id', 'package', 'reason', 'revisit'] as const) {
      if (!entry[field]?.trim()) {
        problems.push(`${acceptedFile}[${index}]: add \`${field}\`.`);
      }
    }
  }
  const found = new Set<string>();
  for (const [name, advisories] of Object.entries(report)) {
    for (const advisory of advisories.filter((each) => reported.has(each.severity))) {
      const id = ghsaOf(advisory);
      found.add(id);
      if (!accepted.some((entry) => entry.id === id)) {
        problems.push(
          `${name} ${advisory.vulnerable_versions}: ${advisory.severity}: ${advisory.title} (${id}). Run \`mise exec -- bun audit fix\`, or upgrade the direct dependency that pulls it in.`,
        );
      }
    }
  }
  for (const entry of accepted) {
    if (entry.id && !found.has(entry.id)) {
      problems.push(
        `${acceptedFile}: the audit no longer reports ${entry.id} (${entry.package}). Delete its entry.`,
      );
    }
  }
  return problems;
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, '..');
  const accepted: Array<Accepted> =
    parse(await Bun.file(path.join(root, acceptedFile)).text()) ?? [];
  const run = Bun.spawnSync(['bun', 'audit', '--prod', '--json'], { cwd: root });
  const output = run.stdout.toString().trim();
  if (!output.startsWith('{')) {
    console.error(
      `The audit returned no report. Check the network and the registry setting.\n${run.stderr.toString()}`,
    );
    process.exit(1);
  }
  const problems = auditProblems(JSON.parse(output) as Report, accepted);
  if (problems.length > 0) {
    console.error(
      [
        `Production audit failed (${problems.length}).`,
        'See docs/contributing/setup/dependencies.md#production-audit.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log(`No unaccepted advisories. ${accepted.length} accepted in ${acceptedFile}.`);
  }
}
