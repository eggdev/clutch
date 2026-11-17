import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

import { proofFiles } from '@tools/contract-claims';

/**
 * The claims part of the nightly flake hunt. The blocking runs prove the
 * contract claims on one fixed seed, so a pull request fails only for its own
 * change. This hunt picks a new seed each night, and runs each proof file
 * with that seed and many more runs. A broken claim is a defect, not a flaky
 * test, so the hunt fails. See
 * docs/contributing/architecture/contract.md#claims.
 */

/** The runs of each command in the hunt. 40 is the count of a blocking run. */
export const huntRuns = 20_000;

/** The time limit of one proof test in milliseconds. The default of `bun test` is 5 seconds. */
const testTimeout = 600_000;

/** A new seed from 1 to 2^31 - 1. */
export function newSeed(): number {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return (value % 2_147_483_647) + 1;
}

/** One broken claim that the output of a failed proof names. */
export type Broken = { readonly command: string; readonly claim: string };

/**
 * The broken claims in the output of a failed proof. `proveClaims` writes a
 * line `The command <name> breaks a claim of its contract:`, and below it one
 * line `  <claim>, run <n>: ...` for each broken claim.
 */
export function brokenClaims(output: string): Array<Broken> {
  const found: Array<Broken> = [];
  let command: string | undefined;
  for (const line of output.split('\n')) {
    const head = /^The command (\S+) breaks a claim of its contract:$/u.exec(line);
    if (head) {
      command = head[1];
      continue;
    }
    const claim = /^ {2}(\S.*?), run \d+: /u.exec(line);
    if (claim && command !== undefined) {
      found.push({ command, claim: claim[1] });
    } else if (!line.startsWith('  ')) {
      command = undefined;
    }
  }
  return found;
}

/** The package of a proof file, such as `notes` for `packages/notes/runtime/contract-claims.test.ts`. */
const packageOf = (file: string) => file.split('/')[1] ?? file;

/** What the run of one proof file gave. */
export type FileResult = {
  readonly file: string;
  readonly passed: boolean;
  readonly output: string;
};

/** Runs one proof file with the seed and the run count. */
export type RunProof = (file: string, seed: number, runs: number) => FileResult;

const runProof: RunProof = (file, seed, runs) => {
  const result = spawnSync('bun', ['test', '--timeout', String(testTimeout), file], {
    env: { ...process.env, CLAIMS_SEED: String(seed), CLAIMS_RUNS: String(runs) },
    encoding: 'utf-8',
  });
  return { file, passed: result.status === 0, output: `${result.stdout}${result.stderr}` };
};

/** The line that runs one proof file again with the same inputs. */
export const againLine = (file: string, seed: number, runs: number) =>
  `CLAIMS_SEED=${seed} CLAIMS_RUNS=${runs} mise exec -- bun test ${file}`;

/** Where the hunt writes: the console and the process environment, or a test's capture. */
export type Sink = {
  readonly env: Record<string, string | undefined>;
  readonly log: (line: string) => void;
};

/**
 * Runs each proof file with `seed` and `runs`. It prints the seed first, a
 * line for each file, and an error annotation for each broken claim. It
 * writes the same to the step summary. It returns 1 when a proof failed.
 */
export function huntClaims(
  files: ReadonlyArray<string>,
  seed: number,
  runs: number,
  sink: Sink,
  run: RunProof = runProof,
): number {
  sink.log(`Seed: ${seed}. Runs of each command: ${runs}.`);
  const summary = [
    '## Contract claims with a new seed',
    '',
    `Seed ${seed}, with ${runs} runs of each command. Each night has a new seed.`,
    '',
  ];
  let failed = 0;
  for (const file of files) {
    const result = run(file, seed, runs);
    const again = againLine(file, seed, runs);
    if (result.passed) {
      sink.log(`${file}: each claim holds.`);
      summary.push(`- \`${packageOf(file)}\`: each claim holds.`);
      continue;
    }
    failed += 1;
    sink.log(result.output);
    const broken = brokenClaims(result.output);
    const named =
      broken.length > 0
        ? broken.map(({ command, claim }) => `${command} breaks "${claim}"`)
        : ['the proof failed and named no broken claim. Read the log'];
    for (const what of named) {
      sink.log(
        `::error file=${file},title=Contract claim broken with a new seed::Package ${packageOf(file)}: ${what}. Run it again: ${again}`,
      );
    }
    summary.push(`- \`${packageOf(file)}\`: ${named.join('; ')}. Run it again: \`${again}\``);
  }
  if (files.length === 0) {
    summary.push('No package has a contract, so the hunt proved nothing.');
  }
  summary.push(
    '',
    failed === 0
      ? 'Each claim holds.'
      : `${failed} package(s) break a claim. Fix the defect, and add the failing input as a named test. See docs/contributing/architecture/contract.md#claims.`,
  );
  if (sink.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(sink.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
  }
  return failed === 0 ? 0 : 1;
}

/** The value after a flag such as `--seed`, as a whole number above zero. */
function flag(args: ReadonlyArray<string>, name: string): number | undefined {
  const at = args.indexOf(name);
  if (at === -1) {
    return undefined;
  }
  const value = Number(args[at + 1]);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} takes a whole number above zero, such as ${name} 7.`);
  }
  return value;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const seed = flag(args, '--seed') ?? newSeed();
  const runs = flag(args, '--runs') ?? huntRuns;
  process.exitCode = huntClaims(proofFiles(process.cwd()), seed, runs, {
    env: process.env,
    log: (line) => console.log(line),
  });
}
