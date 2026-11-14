import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { nativeApps } from '@tools/apps';
import { journeys } from '@tools/journeys/journeys';
import { main } from '@tools/journeys/run';

/**
 * Runs the web journeys and prints one report of them: each journey, each device,
 * its result, its outcomes and its screen findings. `mise exec -- bun run verify
 * [journey ids...]` runs every web journey when no ID is given. The report reads
 * the measures files of this run, as `tools/journeys/run.ts` writes them. A
 * journey fails when a device run failed. A screen finding never fails one. The
 * report runs no device, and says so for each native app of the repository. See
 * docs/contributing/setup/verification.md#verify-report.
 */

/** The screen findings of one try: the layout problems as shown, and at the largest text size. */
export type Screen = { asShown: Array<string>; largestText: Array<string> };

/** One try of a device run, as the measures file keeps it. */
export type MeasuredTry = {
  retry: number;
  outcomes?: Array<{ name: string }>;
  screen?: Screen | null;
  failure?: { kind: string; message: string } | null;
};

/** One device run: its result and each of its tries. */
export type MeasuredRun = {
  device: string;
  result: 'passed' | 'failed';
  attempts: Array<MeasuredTry>;
};

/** A journey and its device runs. A journey with no run has no measures file for this run. */
export type MeasuredJourney = { journey: string; runs: Array<MeasuredRun> };

/** The report text and the exit code: 1 when a journey failed, or when the runner exited with an error. */
export type Report = { text: string; exitCode: number };

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** The lines of one finding list, with its count in the label. */
function findingLines(label: string, sentences: ReadonlyArray<string>): Array<string> {
  if (sentences.length === 0) {
    return [`    ${label}: none`];
  }
  return [
    `    ${label}: ${sentences.length} ${plural(sentences.length, 'finding', 'findings')}`,
    ...sentences.map((sentence) => `      - ${sentence}`),
  ];
}

/** The lines of one device run: its result, its outcomes and its screen findings, from the last try. */
function runLines(run: MeasuredRun): Array<string> {
  const last = run.attempts.at(-1);
  const failure = run.attempts.findLast((attempt) => attempt.failure)?.failure;
  let result: string = run.result;
  if (run.result === 'failed' && failure) {
    result = `failed (${failure.kind}): ${failure.message}`;
  }
  const lines = [`  ${run.device}: ${result}`];
  const outcomes = last?.outcomes?.map((outcome) => outcome.name) ?? [];
  if (outcomes.length > 0) {
    lines.push(`    Outcomes: ${outcomes.join(', ')}`);
  }
  if (last?.screen) {
    lines.push(
      ...findingLines('As shown', last.screen.asShown),
      ...findingLines('At the largest text size', last.screen.largestText),
    );
  } else {
    lines.push('    Screen: not recorded');
  }
  return lines;
}

/** The screen findings of the last try of each device run. */
function findingsOf(journey: MeasuredJourney): number {
  let count = 0;
  for (const run of journey.runs) {
    const screen = run.attempts.at(-1)?.screen;
    count += screen ? screen.asShown.length + screen.largestText.length : 0;
  }
  return count;
}

/** Whether a journey failed: no measures file, or a device run that failed. */
function failedJourney(journey: MeasuredJourney): boolean {
  return journey.runs.length === 0 || journey.runs.some((run) => run.result === 'failed');
}

/**
 * The report of the journeys of one run, and its exit code. `runnerCode` is the
 * exit code of the runner. Pure, so the test gives it made-up measures.
 */
export function reportOf(
  list: ReadonlyArray<MeasuredJourney>,
  runnerCode: number,
  onDevice: ReadonlyArray<string> = [],
): Report {
  const lines: Array<string> = [];
  if (list.length === 0) {
    lines.push('No web journey ran.');
  }
  for (const journey of list) {
    lines.push(journey.journey);
    if (journey.runs.length === 0) {
      lines.push(
        '  No measures file: the runner wrote none for this journey. Read its output above.',
      );
    }
    for (const run of journey.runs) {
      lines.push(...runLines(run));
    }
    lines.push('');
  }
  const failed = list.filter(failedJourney).length;
  let findings = 0;
  for (const journey of list) {
    findings += findingsOf(journey);
  }
  if (runnerCode !== 0) {
    lines.push(`The runner exited with code ${runnerCode}. Read its output above.`);
  }
  // A web pass says nothing about a device, so the report names what it did not run.
  for (const app of onDevice) {
    lines.push(
      `Native: not run. This report holds the web runs only, and apps/${app} also runs on a device. Run \`mise exec -- bun run journey --native ios\` on a booted device.`,
    );
  }
  if (failed === 0 && findings === 0 && runnerCode === 0) {
    lines.push('Done: each journey passed, with no screen finding.');
  } else {
    lines.push(
      `Done: ${failed} of ${list.length} ${plural(list.length, 'journey', 'journeys')} failed, with ${findings} screen ${plural(findings, 'finding', 'findings')}.`,
    );
  }
  return { text: lines.join('\n'), exitCode: failed > 0 || runnerCode !== 0 ? 1 : 0 };
}

/**
 * The measures file of a journey of this run, or a journey with no runs when
 * the file is missing or older than the run. An older file is from an earlier run.
 */
export function measuredJourney(root: string, id: string, since: number): MeasuredJourney {
  const file = path.join(root, 'test-results/journeys/measures', `${id}.json`);
  const stat = statSync(file, { throwIfNoEntry: false });
  if (!stat || stat.mtimeMs < since) {
    return { journey: id, runs: [] };
  }
  const data = JSON.parse(readFileSync(file, 'utf-8')) as MeasuredJourney;
  return { journey: id, runs: data.runs };
}

/** Runs the journeys, then prints the report. Returns the exit code. */
export async function verifyMain(root: string, ids: ReadonlyArray<string>): Promise<number> {
  const since = Date.now();
  const web = journeys(root)
    .filter((journey) => journey.platform === 'web')
    .map((journey) => journey.id);
  let runnerCode = 0;
  if (ids.length === 0) {
    runnerCode = await main(root, '--all');
  } else {
    for (const id of ids) {
      runnerCode = Math.max(runnerCode, await main(root, id));
    }
  }
  const selected = ids.length === 0 ? web : [...ids];
  const report = reportOf(
    selected.map((id) => measuredJourney(root, id, since)),
    runnerCode,
    nativeApps(root),
  );
  console.log(report.text);
  return report.exitCode;
}

if (import.meta.main) {
  try {
    process.exitCode = await verifyMain(process.cwd(), process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
