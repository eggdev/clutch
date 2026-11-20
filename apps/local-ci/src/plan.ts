import { parse } from 'yaml';

/** The part of GitHub's pull request object that the service reads. All of it is untrusted. */
export type Pull = {
  number: number;
  draft: boolean;
  user: { login: string };
  head: { sha: string; repo: { full_name: string; fork: boolean } | null };
  base: { repo: unknown };
};

export type Action = { name: string; repo: string; ref: string };

/** What the service needs to know about one job before it runs. */
export type Plan = {
  file: string;
  secrets: Array<string>;
  actions: Array<Action>;
  labels: Array<string>;
  timeout?: number;
};

export type Outcome = {
  state: 'success' | 'failure' | 'error';
  description: string;
  /** The job's own `if:` was false. It runs again when the pull request leaves draft. */
  skipped?: boolean;
  cancelled?: boolean;
};

const fallbackLabels = ['ubuntu-latest', 'ubuntu-26.04', 'ubuntu-24.04', 'self-hosted'];
const pinnedAction = /^([\w.-]+\/[\w.-]+)((?:\/[\w.-]+)*)@([0-9a-f]{40})$/u;

/** Why a pull request must not run, or null when its head commit is trusted. */
export function distrust(repo: string, pull: Pull, authors: ReadonlyArray<string>) {
  if (!/^[0-9a-f]{40}$/u.test(pull.head.sha)) {
    return 'the head commit id is malformed';
  }
  if (pull.head.repo?.full_name !== repo || pull.head.repo.fork) {
    return 'the head branch is not in the watched repository';
  }
  if (!authors.includes(pull.user.login)) {
    return `the author ${JSON.stringify(pull.user.login)} is not on the allowlist`;
  }
  return null;
}

function runsOnPulls(on: unknown) {
  if (typeof on === 'string') {
    return on === 'pull_request';
  }
  return Array.isArray(on)
    ? on.includes('pull_request')
    : typeof on === 'object' && on !== null && 'pull_request' in on;
}

function labelsOf(runsOn: unknown) {
  const labels = [runsOn].flat().filter((label) => /^[\w.-]+$/u.test(String(label)));
  return labels.length > 0 ? labels.map(String) : fallbackLabels;
}

/** The job `name` in the first workflow of one commit that runs on pull requests, or null. */
export function planJob(files: Record<string, string>, name: string): Plan | null {
  for (const [file, text] of Object.entries(files).toSorted()) {
    let workflow: { on?: unknown; env?: unknown; jobs?: Record<string, Record<string, unknown>> };
    try {
      workflow = parse(text) ?? {};
    } catch {
      continue;
    }
    const job = workflow.jobs?.[name];
    if (!job || !runsOnPulls(workflow.on)) {
      continue;
    }
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const uses: Array<string> = steps.map((step) => String(step?.uses ?? ''));
    const named = JSON.stringify([workflow.env, job]).matchAll(
      /\bsecrets(?:\.|\[\\?["'])([A-Za-z_]\w*)/gu,
    );
    const secrets = new Set([...named].map((match) => match[1] ?? ''));
    secrets.delete('GITHUB_TOKEN');
    const timeout = job['timeout-minutes'];
    return {
      file,
      secrets: [...secrets],
      actions: uses.flatMap((use) => {
        const [, repo = '', sub = '', ref = ''] = pinnedAction.exec(use) ?? [];
        return repo ? [{ name: `${repo}${sub}@${ref}`.replaceAll('/', '-'), repo, ref }] : [];
      }),
      labels: labelsOf(job['runs-on']),
      ...(typeof timeout === 'number' ? { timeout } : {}),
    };
  }
  return null;
}

function duration(seconds: number) {
  const whole = Math.round(seconds);
  return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

/** Turns the end of an `act` run into the commit status to post. */
export function outcomeOf(run: {
  exit: number;
  succeeded: boolean;
  seconds: number;
  stopped?: 'timeout' | 'cancelled';
  minutes: number;
}): Outcome {
  if (run.stopped === 'cancelled') {
    return { state: 'error', description: 'Cancelled by a newer commit', cancelled: true };
  }
  if (run.stopped === 'timeout') {
    return { state: 'failure', description: `Timed out after ${run.minutes} min` };
  }
  const took = duration(run.seconds);
  if (run.exit !== 0) {
    return { state: 'failure', description: `Failed in ${took}` };
  }
  return run.succeeded
    ? { state: 'success', description: `Passed in ${took}` }
    : { state: 'success', description: `Skipped by its own condition in ${took}`, skipped: true };
}

/** Replaces each secret value in a log line. A short value would hide ordinary text. */
export function redact(line: string, values: ReadonlyArray<string>) {
  let text = line;
  for (const value of values) {
    text = value.length < 8 ? text : text.replaceAll(value, '***');
  }
  return text;
}

/** Reads `NAME=value` lines. A name with nothing after `=` is empty on purpose. */
export function parseEnv(text: string) {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const [, name, value] = /^([A-Za-z_]\w*)=(.*)$/u.exec(line.trim()) ?? [];
    if (name) {
      values[name] = value ?? '';
    }
  }
  return values;
}

/** Writes the file that `act` reads its secrets or variables from. */
export function dotenv(values: Record<string, string>) {
  return Object.entries(values)
    .map(([name, value]) =>
      /['\n]/u.test(value)
        ? `${name}="${value.replaceAll(/[\\"$]/gu, String.raw`\$&`).replaceAll('\n', String.raw`\n`)}"\n`
        : `${name}='${value}'\n`,
    )
    .join('');
}
