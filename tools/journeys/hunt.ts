import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import type {
  JSONReport,
  JSONReportSuite,
  JSONReportTest,
  JSONReportTestResult,
} from '@playwright/test/reporter';
import { inboxCommandOf, webDevices } from '@tools/journeys/journeys';
import type { Journey } from '@tools/journeys/journeys';

/**
 * The journey part of the nightly flake hunt. `bun run journey --hunt <count>`
 * runs each web journey `count` times on each device with no retry, and
 * Playwright writes a JSON report. This module counts the first-run failures
 * of each journey on each device from that report. The hunt only measures: it
 * quarantines no journey and files nothing. See
 * docs/contributing/end-to-end-testing.md#flake-hunt.
 */

/**
 * The parts of a Playwright JSON report that the count reads, taken from the
 * report types of Playwright. `hunt` passes a whole `JSONReport` to the count,
 * so a change of the report shape in Playwright fails the type check.
 */
type ReportResult = Pick<JSONReportTestResult, 'status' | 'retry'>;
type ReportTest = Pick<JSONReportTest, 'projectName'> & { results: Array<ReportResult> };
type ReportSpec = { tests: Array<ReportTest> };
type ReportSuite = Partial<Pick<JSONReportSuite, 'file'>> & {
  specs?: Array<ReportSpec>;
  suites?: Array<ReportSuite>;
};
export type Report = {
  config: Pick<JSONReport['config'], 'rootDir'>;
  suites: Array<ReportSuite>;
  errors?: Array<{ message?: string }>;
};

/** The first runs of one journey on one device. A skipped run counts as neither. */
type DeviceCount = { device: string; runs: number; failed: number };

export type JourneyCount = { journey: Journey; devices: Array<DeviceCount> };

function specsOf(suite: ReportSuite): Array<ReportSpec> {
  return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specsOf)];
}

/**
 * The first-run failures of each journey on each device. A test file is a top
 * suite of the report, so a data journey counts under its own file, although
 * Playwright places its test in `journey.ts`. Each device is listed, also one
 * with no run, so a journey that did not run never reads as clean.
 */
export function countFirstRuns(
  root: string,
  report: Report,
  selected: ReadonlyArray<Journey>,
  devices: ReadonlyArray<string>,
): Array<JourneyCount> {
  const counts = new Map<string, Map<string, DeviceCount>>();
  for (const journey of selected) {
    counts.set(
      journey.file,
      new Map(devices.map((device) => [device, { device, runs: 0, failed: 0 }])),
    );
  }
  for (const suite of report.suites) {
    const file = path.relative(root, path.resolve(report.config.rootDir, suite.file ?? ''));
    const byDevice = counts.get(file);
    if (byDevice === undefined) {
      continue;
    }
    for (const test of specsOf(suite).flatMap((spec) => spec.tests)) {
      const first = test.results.find((result) => result.retry === 0);
      const count = byDevice.get(test.projectName);
      if (first === undefined || first.status === 'skipped' || count === undefined) {
        continue;
      }
      count.runs += 1;
      if (first.status !== 'passed') {
        count.failed += 1;
      }
    }
  }
  return selected.map((journey) => ({
    journey,
    devices: [...(counts.get(journey.file)?.values() ?? [])],
  }));
}

const cell = (count: DeviceCount) =>
  count.runs === 0 ? 'no run' : `${count.failed} of ${count.runs}`;

/** One log line for each journey, such as `notes-sync: Phone 1 of 20, Tablet 0 of 20`. */
export function huntLines(counts: ReadonlyArray<JourneyCount>): Array<string> {
  return counts.map(
    ({ journey, devices }) =>
      `${journey.id}: ${devices.map((count) => `${count.device} ${cell(count)}`).join(', ')}`,
  );
}

/** The journeys that ran on no device. The hunt measured nothing for them. */
const notRun = (counts: ReadonlyArray<JourneyCount>) =>
  counts.filter(({ devices }) => devices.every((count) => count.runs === 0));

/**
 * The warning annotations of a hunt. A journey that failed a first run gets
 * one, and a journey with a device that it did not run on gets another one.
 */
export function huntWarnings(counts: ReadonlyArray<JourneyCount>, repeat: number): Array<string> {
  return counts.flatMap(({ journey, devices }) => {
    const cells = devices.map((count) => `${count.device} ${cell(count)}`).join(', ');
    const warnings: Array<string> = [];
    if (devices.some((count) => count.failed > 0)) {
      warnings.push(
        `::warning title=Journey failed a first run::${journey.id} (${journey.file}) failed first runs out of ${repeat} with no retry: ${cells}.`,
      );
    }
    if (devices.some((count) => count.runs === 0)) {
      warnings.push(
        `::warning title=Journey did not run::${journey.id} (${journey.file}) did not run on each device, so the hunt did not measure it there: ${cells}.`,
      );
    }
    return warnings;
  });
}

/** The step summary: a table with one row for each journey and one column for each device. */
export function huntSummary(
  counts: ReadonlyArray<JourneyCount>,
  devices: ReadonlyArray<string>,
  repeat: number,
  errors: ReadonlyArray<string>,
): string {
  const failed = counts.filter(({ devices: list }) => list.some((count) => count.failed > 0));
  const unmeasured = counts.filter(({ devices: list }) => list.some((count) => count.runs === 0));
  const lines = [
    '## Journey first-run failures',
    '',
    `Each web journey ran ${repeat} times on each device, with no retry. A cell counts the runs that failed out of the runs that ran.`,
    '',
    `| Journey | ${devices.join(' | ')} |`,
    `| --- | ${devices.map(() => '---').join(' | ')} |`,
    ...counts.map(
      ({ journey, devices: list }) =>
        `| \`${journey.id}\` | ${list.map((count) => cell(count)).join(' | ')} |`,
    ),
    '',
    failed.length === 0
      ? 'No journey failed a first run.'
      : `${failed.length} journey(s) failed a first run. File one issue for each, with the cause. See docs/contributing/end-to-end-testing.md#flake-hunt.`,
  ];
  if (unmeasured.length > 0) {
    lines.push(
      '',
      `The hunt did not measure ${unmeasured.map(({ journey }) => `\`${journey.id}\``).join(', ')} on each device. A cell with \`no run\` is not a pass.`,
    );
  }
  if (errors.length > 0) {
    lines.push(
      '',
      'Playwright reported errors outside the journeys:',
      '',
      ...errors.map((error) => `- ${error.split('\n')[0]}`),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Where the hunt writes its lines: the console and the process environment, or a test's capture. */
type Sink = {
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  error: (line: string) => void;
};

/**
 * Starts Playwright on the selected journeys with these extra environment
 * variables and arguments, and a time limit of `tries` journey budgets.
 * Resolves to the exit code.
 */
type RunPlaywright = (
  env: Record<string, string>,
  args: ReadonlyArray<string>,
  tries: number,
) => Promise<number>;

/** The JSON report of a hunt. Each hunt writes it again. */
const huntReport = (root: string) => path.join(root, 'test-results/journeys/hunt.json');

/**
 * Runs each selected journey `repeat` times on each device with no retry,
 * and reports the first-run failures of each one: a log line, a warning for
 * each journey that failed a run, and a table in the step summary. Returns 0
 * when each journey ran, whatever its runs did. Returns 1 when the hunt
 * measured nothing for a journey: Playwright wrote no report, it reported an
 * error outside the journeys, or a journey ran on no device.
 */
export async function hunt(
  root: string,
  selected: ReadonlyArray<Journey>,
  repeat: number,
  sink: Sink,
  run: RunPlaywright,
): Promise<number> {
  const report = huntReport(root);
  rmSync(report, { force: true });
  await run(
    { JOURNEY_REPORT: report, JOURNEY_INBOX: JSON.stringify(inboxCommandOf(root) ?? []) },
    ['--repeat-each', String(repeat)],
    webDevices.length * repeat,
  );
  if (!existsSync(report)) {
    sink.error(
      'The hunt wrote no report, so nothing was counted. Read the Playwright output above.',
    );
    return 1;
  }
  const data = JSON.parse(readFileSync(report, 'utf-8')) as JSONReport;
  const devices = webDevices.map((device) => device.name);
  const counts = countFirstRuns(root, data, selected, devices);
  const errors = (data.errors ?? []).map((error) => error.message ?? 'An unnamed error.');
  sink.log(`First-run failures out of ${repeat} runs on each device, with no retry:`);
  for (const line of [...huntLines(counts), ...huntWarnings(counts, repeat)]) {
    sink.log(line);
  }
  for (const error of errors) {
    sink.error(error);
  }
  if (sink.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(sink.env.GITHUB_STEP_SUMMARY, huntSummary(counts, devices, repeat, errors));
  }
  const missing = notRun(counts);
  if (errors.length > 0 || missing.length > 0) {
    sink.error(
      `The hunt did not measure each journey: ${errors.length} error(s) outside the journeys, and ${missing.length} journey(s) with no run. Read the Playwright output above.`,
    );
    return 1;
  }
  return 0;
}
