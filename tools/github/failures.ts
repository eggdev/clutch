import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';
import type { Check } from '@tools/github/status';

const ansi = new RegExp(String.raw`${String.fromCodePoint(27)}\[[0-9;]*[A-Za-z]`, 'gu');

/** A log line without its ANSI codes and the runner's timestamp. */
const clean = (line: string) =>
  line
    .replaceAll(ansi, '')
    .replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/u, '')
    .trimEnd();

export type Failure = {
  check: string;
  url: string;
  step?: string;
  /** The Nx tasks that failed, each with its own output. */
  tasks: Array<{ name: string; output: string }>;
  tail: string;
};

/**
 * The failed step and the failed Nx tasks in a GitHub Actions job log. Nx
 * groups a failed task's output as `##[group]❌ > nx run <task>`, so the task
 * output comes from the log, not from a path into the runner's Nx cache.
 */
export function readJobLog(log: string, lines = 40) {
  const rows = log.split('\n').map(clean);
  const listed: Array<string> = [];
  const start = rows.lastIndexOf('Failed tasks:');
  if (start !== -1) {
    for (const row of rows.slice(start + 1)) {
      const task = /^- (\S+)$/u.exec(row)?.[1];
      if (task) {
        listed.push(task);
      } else if (row !== '') {
        break;
      }
    }
  }
  const tasks = listed.map((name) => {
    const open = rows.findIndex(
      (row) => row.startsWith('##[group]') && row.endsWith(`> nx run ${name}`),
    );
    if (open === -1) {
      return { name, output: '' };
    }
    const close = rows.findIndex((row, index) => index > open && row === '##[endgroup]');
    return {
      name,
      output: rows
        .slice(open + 1, close === -1 ? undefined : close)
        .join('\n')
        .trim(),
    };
  });
  const error = rows.findLastIndex((row) => row.startsWith('##[error]'));
  const end = error === -1 ? rows.length : error + 1;
  const stepAt = rows.findLastIndex((row, index) => index < end && row.startsWith('##[group]Run '));
  const step = stepAt === -1 ? undefined : rows[stepAt].slice('##[group]Run '.length);
  const tail = rows
    .slice(Math.max(stepAt + 1, end - lines), end)
    .filter((row) => !row.startsWith('##[group]') && row !== '##[endgroup]')
    .join('\n')
    .trim();
  return { step, tasks, tail };
}

/** The job id in a check run's details URL. */
const jobOf = (url: string) => /\/actions\/runs\/\d+\/job\/(\d+)/u.exec(url)?.[1];

/** The failed checks of a PR, each with the end of its log. */
export async function failures(run: Run, checks: Array<Check>): Promise<Array<Failure>> {
  const found: Array<Failure> = [];
  for (const check of checks.filter((item) => item.state === 'fail')) {
    const job = jobOf(check.url);
    if (!job) {
      found.push({ check: check.name, url: check.url, tasks: [], tail: 'No GitHub Actions log.' });
      continue;
    }
    const log = await must(run, [
      'gh',
      'api',
      `repos/{owner}/{repo}/actions/jobs/${job}/logs`,
      '--allow-escape-sequences',
    ]);
    found.push({ check: check.name, url: check.url, ...readJobLog(log) });
  }
  return found;
}

export function renderFailures(found: Array<Failure>) {
  if (found.length === 0) {
    return 'No check failed.';
  }
  return found
    .map((failure) => {
      const head = `== ${failure.check}${failure.step ? `, step: ${failure.step}` : ''}\n${failure.url}`;
      const tasks = failure.tasks.map(
        (task) => `-- Nx task ${task.name} failed:\n${task.output || '(no output in the log)'}`,
      );
      return [head, ...tasks, `-- End of the log:\n${failure.tail}`].join('\n');
    })
    .join('\n\n');
}
