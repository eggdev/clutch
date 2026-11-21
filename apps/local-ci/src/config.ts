import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parse } from 'yaml';

import { parseEnv } from '@/plan';

/** `timeout_minutes` is the default for a job with no timeout, and the most that a job can ask for. */
export type Limits = { cpus: number; memory: string; timeout_minutes: number };

export type RepoConfig = {
  /** The job names to run. Each one is the `context` of its commit status. */
  checks: Array<string>;
  authors: Array<string>;
  limits?: Record<string, Partial<Limits>>;
  op_environment?: string;
  vars?: Record<string, string>;
};

export type Config = {
  poll_seconds: number;
  max_jobs: number;
  log_days: number;
  image: string;
  /** An action that `act` cannot run as pinned: its repository, and the commit to run in its place. */
  action_overrides?: Record<string, string>;
  job_token_file?: string;
  defaults: Limits;
  repos: Record<string, RepoConfig>;
};

const xdg = (name: string, fallback: string) =>
  path.join(process.env[name] || path.join(os.homedir(), fallback), 'local-ci');

export const paths = {
  config: xdg('XDG_CONFIG_HOME', '.config'),
  state: xdg('XDG_STATE_HOME', '.local/state'),
  cache: xdg('XDG_CACHE_HOME', '.cache'),
};

export function loadConfig(): Config {
  return {
    poll_seconds: 30,
    max_jobs: 3,
    log_days: 14,
    image: 'local-ci-job:1',
    defaults: { cpus: 4, memory: '12g', timeout_minutes: 60 },
    repos: {},
    ...parse(readFileSync(path.join(paths.config, 'config.yaml'), 'utf-8')),
  };
}

/** A file that holds secrets must be readable by its owner only. */
export function readPrivate(file: string) {
  const mode = statSync(file).mode % 0o1000;
  if (mode % 0o100 !== 0) {
    throw new Error(`${file} has mode ${mode.toString(8)}. Run chmod 600 on it.`);
  }
  return readFileSync(file, 'utf-8');
}

/** The secrets of one repository. A repository with no file has no secrets. */
export function readSecrets(repo: string) {
  const file = path.join(paths.config, 'secrets', `${repo.replace('/', '__')}.env`);
  return statSync(file, { throwIfNoEntry: false }) ? parseEnv(readPrivate(file)) : {};
}
