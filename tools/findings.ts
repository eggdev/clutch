import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * One problem that a check found, as data. `id` names the kind of problem as
 * `<check>/<problem>` in kebab case. It stays the same when the message is
 * reworded, so an agent can match on it. `line` is left out for a problem
 * with the whole file. An empty `fix` means that `problem` already says it,
 * as a message from another tool does. See
 * docs/contributing/setup/checks.md#findings.
 */
export type Finding = {
  readonly id: string;
  readonly file: string;
  readonly line?: number;
  readonly problem: string;
  readonly fix: string;
};

/**
 * The text form of a finding: the file, the problem and the fix. A problem of
 * several lines puts the fix on a line of its own.
 */
export function formatFinding({ file, line, problem, fix }: Finding): string {
  const where = line === undefined ? file : `${file}:${line}`;
  if (!fix) {
    return `${where}: ${problem}`;
  }
  return `${where}: ${problem}${problem.includes('\n') ? '\n  ' : ' '}${fix}`;
}

/**
 * The folder where each moved check writes its findings, so `validate --json`
 * can read them across the Nx process boundary. Git ignores `tmp/`.
 */
const findingsFolder = 'tmp/check-findings';

/**
 * Writes the findings of `check` to `<root>/tmp/check-findings/<check>.json`.
 * A check writes the file on each run, also with no findings, so the file
 * says that the check ran. A cached Nx target must list the file in its
 * `outputs`, so a cache hit restores it.
 */
export function writeFindings(root: string, check: string, findings: ReadonlyArray<Finding>) {
  const folder = path.join(root, findingsFolder);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, `${check}.json`), `${JSON.stringify(findings, null, 2)}\n`);
}

/** Deletes the findings of an earlier run, so a collection reads only this run. */
export function clearFindings(root: string) {
  rmSync(path.join(root, findingsFolder), { recursive: true, force: true });
}

/**
 * Each check that writes findings. `validate --json` names a check of this
 * list that wrote no file as missing, so a check that stopped early does not
 * read as a check that found nothing. A check that moves to findings joins
 * the list, and a test holds that.
 */
export const findingChecks: ReadonlyArray<string> = ['check-contract', 'check-file-size'];

/** The findings in one file, or `undefined` for a file that a stopped check left half written. */
function parseFindings(file: string): Array<Finding> | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * The findings of each check that wrote a file, by check name, in name order.
 * A file that does not parse is left out, so its check reads as missing.
 */
export function readFindings(root: string): Record<string, Array<Finding>> {
  const folder = path.join(root, findingsFolder);
  let files: Array<string>;
  try {
    files = readdirSync(folder).filter((file) => file.endsWith('.json'));
  } catch {
    return {};
  }
  const byCheck: Record<string, Array<Finding>> = {};
  for (const file of files.toSorted()) {
    const findings = parseFindings(path.join(folder, file));
    if (findings) {
      byCheck[file.slice(0, -'.json'.length)] = findings;
    }
  }
  return byCheck;
}
