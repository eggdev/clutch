import path from 'node:path';

import type { Journey } from '@tools/journeys/journeys';

/**
 * The journey part of the nightly flake hunt. `bun run journey --hunt <count>`
 * runs each web journey `count` times on each device with no retry, and
 * Playwright writes a JSON report. This module counts the first-run failures
 * of each journey on each device from that report. The hunt only measures: it
 * quarantines no journey and files nothing. See
 * docs/contributing/end-to-end-testing.md#flake-hunt.
 */

/** The parts of a Playwright JSON report that the count reads. */
type ReportResult = { status: string; retry: number };
type ReportTest = { projectName: string; results: Array<ReportResult> };
type ReportSpec = { tests: Array<ReportTest> };
type ReportSuite = { file?: string; specs?: Array<ReportSpec>; suites?: Array<ReportSuite> };
export type Report = {
  config: { rootDir: string };
  suites: Array<ReportSuite>;
  errors?: Array<{ message?: string }>;
};

/** The first runs of one journey on one device. A skipped run counts as neither. */
export type DeviceCount = { device: string; runs: number; failed: number };

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

/** A warning annotation for each journey that failed a first run, or that did not run on a device. */
export function huntWarnings(counts: ReadonlyArray<JourneyCount>, repeat: number): Array<string> {
  return counts
    .filter(({ devices }) => devices.some((count) => count.failed > 0 || count.runs === 0))
    .map(
      ({ journey, devices }) =>
        `::warning title=Journey failed a first run::${journey.id} (${journey.file}) failed first runs out of ${repeat} with no retry: ${devices.map((count) => `${count.device} ${cell(count)}`).join(', ')}.`,
    );
}

/** The step summary: a table with one row for each journey and one column for each device. */
export function huntSummary(
  counts: ReadonlyArray<JourneyCount>,
  devices: ReadonlyArray<string>,
  repeat: number,
  errors: ReadonlyArray<string>,
): string {
  const failed = counts.filter(({ devices: list }) => list.some((count) => count.failed > 0));
  const lines = [
    '## Journey first-run failures',
    '',
    `Each web journey ran ${repeat} times on each device, with no retry. A cell counts the runs that failed out of the runs that ran. The blocking \`journeys\` check keeps its one retry.`,
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
