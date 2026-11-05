import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { limits } from '@/bench/harness';
import type { PairResult } from '@/bench/run';

/** The record of one run of a suite, as the result file holds it. */
export type BenchResult = {
  benchmark: string;
  date: string;
  commit: string;
  agent: string;
  limits: typeof limits;
  runs: Array<PairResult>;
};

function duration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}

function table(rows: Array<Array<string>>) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column]))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

/** A table of each pair, then one line for each config: its passes, its time and its lines. */
export function renderResult(result: BenchResult) {
  const pairs = table([
    ['Task', 'Config', 'Result', 'Exit', 'Time', 'Lines', 'Turns'],
    ...result.runs.map((run) => [
      run.task,
      run.config,
      run.pass ? 'pass' : 'fail',
      run.exit,
      duration(run.seconds),
      String(run.lines),
      run.turns === undefined ? '-' : String(run.turns),
    ]),
  ]);
  const names = [...new Set(result.runs.map((run) => run.config))];
  const totals = table([
    ['Config', 'Model', 'Passed', 'Time', 'Lines'],
    ...names.map((name) => {
      const runs = result.runs.filter((run) => run.config === name);
      const sum = (pick: (run: PairResult) => number) =>
        runs.reduce((total, run) => total + pick(run), 0);
      return [
        name,
        runs[0].model,
        `${runs.filter((run) => run.pass).length}/${runs.length}`,
        duration(sum((run) => run.seconds)),
        String(sum((run) => run.lines)),
      ];
    }),
  ]);
  return `${pairs}\n\n${totals}`;
}

/**
 * `<date>-<short sha>.json` in the suite's `results/` folder. A second run on
 * the same day at the same commit gets `-2`, then `-3`, so no result is lost.
 */
export function resultFile(suiteDir: string, result: BenchResult) {
  const stem = path.join(
    suiteDir,
    'results',
    `${result.date.slice(0, 10)}-${result.commit.slice(0, 7)}`,
  );
  let file = `${stem}.json`;
  for (let count = 2; existsSync(file); count += 1) {
    file = `${stem}-${count}.json`;
  }
  return file;
}

export async function writeResult(file: string, result: BenchResult) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
}
