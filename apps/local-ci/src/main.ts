#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Config, RepoConfig } from '@/config';
import { loadConfig, paths, readPrivate, readSecrets } from '@/config';
import { api, readToken } from '@/github';
import type { Outcome, Pull } from '@/plan';
import { distrust } from '@/plan';
import { fetchMirror, prune, runJob, sweep } from '@/sandbox';

/** One watched pull request: its head commit and the checks that ended for it. */
type Seen = { sha: string; draft: boolean; done: Record<string, 'done' | 'skipped'> };

const stateFile = path.join(paths.state, 'state.json');
const reruns = path.join(paths.state, 'rerun');
const seen = new Map<string, Seen>(
  existsSync(stateFile) ? Object.entries(JSON.parse(readFileSync(stateFile, 'utf-8'))) : [],
);
/** Aborts the jobs of a pull request when a newer commit replaces its head. */
const heads = new Map<string, AbortController>();
const running = new Set<string>();
const waiting: Array<(at: number) => void> = [];
const said = new Set<string>();
const free: Array<number> = [];

async function save() {
  await mkdir(paths.state, { recursive: true });
  await writeFile(`${stateFile}.tmp`, JSON.stringify(Object.fromEntries(seen), null, 2));
  await rename(`${stateFile}.tmp`, stateFile);
}

/** Waits for one of the `max_jobs` slots and gives its number. */
function slot() {
  const at = free.pop();
  return at === undefined
    ? new Promise<number>((resolve) => {
        waiting.push(resolve);
      })
    : at;
}

async function runCheck(config: Config, token: string, repo: string, pull: Pull, job: string) {
  const key = `${repo}#${pull.number}`;
  const { sha } = pull.head;
  const signal = heads.get(key)?.signal ?? AbortSignal.abort();
  const rc: RepoConfig = config.repos[repo] ?? { checks: [], authors: [] };
  const logFile = path.join(paths.state, 'logs', repo.replace('/', '__'), sha, `${job}.log`);
  async function post(state: Outcome['state'] | 'pending', description: string) {
    const status = { state, description, context: job };
    try {
      await api(token, 'POST', `/repos/${repo}/statuses/${sha}`, status);
    } catch (error) {
      console.log(`${key} ${job}: the status ${state} was not posted: ${String(error)}`);
    }
  }
  running.add(`${key}/${job}`);
  await post('pending', 'Waiting for a local CI slot');
  const at = await slot();
  const limits = { ...config.defaults, ...rc.limits?.[job] };
  // Each slot owns its cores, so a job sees a machine of that size and no job takes another's.
  const width = Math.floor(os.availableParallelism() / config.max_jobs);
  let result: Outcome;
  try {
    result = await runJob({
      repo,
      pull,
      job,
      limits,
      cpuset: `${at * width}-${at * width + Math.min(limits.cpus, width) - 1}`,
      overrides: config.action_overrides ?? {},
      image: config.image,
      token: config.job_token_file ? readPrivate(config.job_token_file).trim() : token,
      secrets: readSecrets(repo),
      environment: rc.op_environment,
      vars: rc.vars ?? {},
      logFile,
      signal,
      onStart: () => post('pending', 'Running on local CI'),
    });
  } catch (error) {
    console.log(`${key} ${job}: ${String(error)}`);
    result = { state: 'error', description: 'Local CI could not run the job. Read its log.' };
  }
  const wake = waiting.shift() ?? ((slotNumber: number) => free.push(slotNumber));
  wake(at);
  await post(result.state, result.description);
  console.log(`${key} ${sha.slice(0, 8)} ${job}: ${result.state}: ${result.description}`);
  const record = seen.get(key);
  if (record?.sha === sha && record.draft === pull.draft && !result.cancelled) {
    record.done[job] = result.skipped ? 'skipped' : 'done';
    await save();
  }
  running.delete(`${key}/${job}`);
}

/** `local-ci rerun` leaves one file for each request. The service forgets those results. */
async function takeReruns() {
  for (const name of existsSync(reruns) ? readdirSync(reruns) : []) {
    const [key = '', job] = readFileSync(path.join(reruns, name), 'utf-8').trim().split(' ');
    const record = seen.get(key);
    if (record) {
      const kept = Object.entries(record.done).filter(([done]) => job && job !== done);
      record.done = Object.fromEntries(kept);
    }
    await rm(path.join(reruns, name));
  }
}

async function poll(config: Config, token: string) {
  await takeReruns();
  for (const [repo, rc] of Object.entries(config.repos)) {
    const pulls = (await api(
      token,
      'GET',
      `/repos/${repo}/pulls?state=open&per_page=100`,
    )) as Array<Pull>;
    let fetched = false;
    for (const pull of pulls) {
      const key = `${repo}#${pull.number}`;
      const why = distrust(repo, pull, rc.authors);
      if (why) {
        if (!said.has(`${key} ${why}`)) {
          said.add(`${key} ${why}`);
          console.log(`${key}: not run, because ${why}.`);
        }
        continue;
      }
      let record = seen.get(key);
      if (record?.sha !== pull.head.sha) {
        heads.get(key)?.abort();
        heads.delete(key);
        record = { sha: pull.head.sha, draft: pull.draft, done: {} };
        seen.set(key, record);
      }
      if (!heads.has(key)) {
        heads.set(key, new AbortController());
      }
      if (record.draft !== pull.draft) {
        // A job that its own condition skipped can run when the pull request leaves draft.
        record.draft = pull.draft;
        record.done = Object.fromEntries(
          Object.entries(record.done).filter(([, how]) => how === 'done'),
        );
      }
      const todo = rc.checks.filter((job) => !record.done[job] && !running.has(`${key}/${job}`));
      if (todo.length > 0 && !fetched) {
        await fetchMirror(repo, token);
        fetched = true;
      }
      for (const job of todo) {
        void runCheck(config, token, repo, pull, job);
      }
    }
    for (const key of seen.keys()) {
      if (key.startsWith(`${repo}#`) && !pulls.some((pull) => key === `${repo}#${pull.number}`)) {
        heads.get(key)?.abort();
        seen.delete(key);
      }
    }
  }
  await save();
}

async function serve() {
  const config = loadConfig();
  free.push(...Array.from({ length: config.max_jobs }, (_, at) => at));
  await sweep();
  console.log(
    `local-ci watches ${Object.keys(config.repos).join(', ')} with ${config.max_jobs} job slots.`,
  );
  for (;;) {
    try {
      await poll(config, readToken());
      await prune(config.log_days);
    } catch (error) {
      console.log(`The poll failed: ${String(error)}`);
    }
    await Bun.sleep(config.poll_seconds * 1000);
  }
}

const [command, key, job] = process.argv.slice(2);
if (command === 'serve') {
  await serve();
} else if (command === 'rerun' && key) {
  await mkdir(reruns, { recursive: true });
  await writeFile(path.join(reruns, `${Date.now()}`), [key, job].filter(Boolean).join(' '));
  console.log(`The service runs ${job ?? 'each check'} of ${key} again at its next poll.`);
} else {
  console.log('Usage: local-ci serve | local-ci rerun <owner>/<repo>#<number> [job]');
  process.exitCode = 1;
}
