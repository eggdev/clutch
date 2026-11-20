import { createWriteStream, existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Limits } from '@/config';
import { paths, readPrivate } from '@/config';
import type { Action, Outcome, Plan, Pull } from '@/plan';
import { dotenv, outcomeOf, planJob, redact } from '@/plan';

export type JobRequest = {
  repo: string;
  pull: Pull;
  job: string;
  limits: Limits;
  cpuset: string;
  overrides: Record<string, string>;
  image: string;
  /** The value of `github.token` inside the job. */
  token: string;
  secrets: Record<string, string>;
  vars: Record<string, string>;
  logFile: string;
  signal: AbortSignal;
  onStart: () => Promise<unknown>;
};

const label = 'local-ci=1';
const home = '/home/runner';
/** Runs as root in the new container. It starts the container's own Docker daemon. */
const setup = [
  `mkfifo -m 600 ${home}/lci/secrets && chown -R runner:runner ${home}`,
  'dockerd >/var/log/dockerd.log 2>&1 &',
  'for i in $(seq 60); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1',
].join('\n');
let counter = 0;

type Ready = { plan: Plan; secrets: Record<string, string> };

/** Runs one command with no shell. The arguments can hold untrusted text. */
async function sh(cmd: Array<string>, stdin?: string, env?: Record<string, string>) {
  const run = Bun.spawn(cmd, {
    stdin: stdin === undefined ? 'ignore' : new Blob([stdin]),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
  });
  const [out, error, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  if (code !== 0) {
    throw new Error(`${cmd.slice(0, 3).join(' ')} failed (exit ${code}): ${error.slice(-400)}`);
  }
  return out;
}

function docker(...args: Array<string>) {
  return sh(['docker', ...args]);
}

/** For cleanup and best-effort steps: a failure gives null. */
async function quiet<T>(work: Promise<T>) {
  try {
    return await work;
  } catch {
    return null;
  }
}

/** Removes each container and volume that a run left, such as after a kill of the service. */
export async function sweep() {
  const all = `docker ps -aq --filter label=${label} | xargs -r docker rm -f -v`;
  await sh(['sh', '-c', all]);
  await rm(path.join(paths.cache, 'runs'), { recursive: true, force: true });
}

function mirrorOf(repo: string) {
  return path.join(paths.cache, 'mirrors', `${repo}.git`);
}

/** Removes the logs and kept artifacts of each commit that is older than `days`. */
export async function prune(days: number) {
  const logs = path.join(paths.state, 'logs');
  await mkdir(logs, { recursive: true });
  const old = `-mindepth 2 -maxdepth 2 -mtime +${days} -exec rm -rf {} +`.split(' ');
  await sh(['find', logs, ...old]);
}

/**
 * Updates the service's own bare copy of a repository. The token stays out of
 * argv and of the git config. No job and no developer checkout touches this copy.
 */
export async function fetchMirror(repo: string, token: string) {
  const mirror = mirrorOf(repo);
  await sh(['git', 'init', '--quiet', '--bare', mirror]);
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  const refs = ['+refs/heads/*:refs/heads/*', '+refs/pull/*/head:refs/pull/*/head'];
  const fetch = ['fetch', '--quiet', '--prune', '--no-tags', `https://github.com/${repo}.git`];
  await sh(['git', '-C', mirror, ...fetch, ...refs], undefined, {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  });
}

const fetching = new Map<string, Promise<string | null>>();
const shallow =
  'git init -q "$0" && cd "$0" && git remote add origin "$1" && git fetch -q --depth=1 origin "$2" && git checkout -q --detach FETCH_HEAD && mv "$0" "$3"';

/**
 * A shallow copy of one pinned action, fetched once by the service. Each job gets
 * its own copy, so no job can change what another job runs.
 */
function fetchAction({ name, repo, ref }: Action, other?: string) {
  const dir = path.join(paths.cache, 'actions', other ? `${name}+${other}` : name);
  async function clone() {
    const args = [`${dir}.${process.pid}.tmp`, `https://github.com/${repo}`, other ?? ref, dir];
    const made = existsSync(dir) || (await quiet(sh(['sh', '-c', shallow, ...args]))) !== null;
    return made ? dir : null;
  }
  const pending = fetching.get(dir) ?? clone();
  fetching.set(dir, pending);
  return pending;
}

/** The workflow files of a checkout. A symbolic link is skipped, so no file outside it is read. */
function workflowsOf(source: string) {
  const dir = path.join(source, '.github/workflows');
  const files: Record<string, string> = {};
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (/\.ya?ml$/u.test(name) && lstatSync(path.join(dir, name)).isFile()) {
      files[name] = readFileSync(path.join(dir, name), 'utf-8');
    }
  }
  return files;
}

/** A value of the secrets file: the secret itself, or a 1Password reference to it. */
async function reveal(name: string, value = '') {
  if (!value.startsWith('op://')) {
    return value;
  }
  try {
    const token = readPrivate(path.join(paths.config, 'op-token')).trim();
    return await sh(['op', 'read', '--no-newline', value], undefined, {
      OP_SERVICE_ACCOUNT_TOKEN: token,
    });
  } catch (error) {
    console.log(`${name}: 1Password gave no value for ${value}: ${String(error).slice(0, 300)}`);
    return null;
  }
}

/** The checkout of the exact commit, the job's plan and its secrets. A text when the job cannot start. */
async function prepare(request: JobRequest, run: string, source: string) {
  const { repo, pull, job } = request;
  await mkdir(path.join(run, 'lci'), { recursive: true });
  await sh(['git', 'clone', '--quiet', '--no-checkout', mirrorOf(repo), source]);
  await sh(['git', '-C', source, 'remote', 'set-url', 'origin', `https://github.com/${repo}.git`]);
  await sh(['git', '-C', source, 'checkout', '--quiet', '--detach', pull.head.sha]);
  const plan = planJob(workflowsOf(source), job);
  if (!plan) {
    return `No pull request job named ${job} at this commit`;
  }
  const named = plan.secrets.filter((name) => request.secrets[name] !== undefined);
  const values = await Promise.all(named.map((name) => reveal(name, request.secrets[name])));
  const missing = plan.secrets.filter((name) => (values[named.indexOf(name)] ?? null) === null);
  if (missing.length > 0) {
    return `Missing secret: ${missing.join(', ')}`.slice(0, 140);
  }
  const event = { action: 'synchronize', number: pull.number, pull_request: pull };
  const full = { ...event, repository: pull.base.repo, sender: pull.user };
  await writeFile(path.join(run, 'lci/event.json'), JSON.stringify(full));
  await writeFile(path.join(run, 'lci/vars'), dotenv(request.vars));
  return { plan, secrets: Object.fromEntries(named.map((name, at) => [name, values[at] ?? ''])) };
}

/** Starts the container, runs `act` in it and writes the output to the log, with no secret value. */
async function runAct(request: JobRequest, id: string, run: string, ready: Ready) {
  const { plan, secrets } = ready;
  const { pull, job, limits, image } = request;
  const name = `local-ci-${id}`;
  const started = Date.now();
  await request.onStart();
  const work = `${home}/work/${path.basename(request.repo)}`;
  const size = `--cpuset-cpus ${request.cpuset} --memory ${limits.memory} --memory-swap ${limits.memory}`;
  const own = '--privileged --pids-limit 16384 --mount type=volume,dst=/var/lib/docker';
  const create = `run --detach --name ${name} --label ${label} ${size} ${own}`.split(' ');
  await docker(...create, image);
  await docker('exec', name, 'mkdir', '-p', `${home}/.cache/act`);
  await docker('cp', '--quiet', `${run}/.`, `${name}:${home}`);
  // act takes an overridden action from a folder, under the name that the workflow pins.
  const local: Array<string> = [];
  for (const action of plan.actions) {
    const other = request.overrides[action.repo];
    const dir = await fetchAction(action, other);
    await (dir ? docker('cp', '--quiet', dir, `${name}:${home}/.cache/act/`) : null);
    if (dir && other) {
      const folder = `${home}/.cache/act/${path.basename(dir)}`;
      local.push('--local-repository', `${action.repo}@${action.ref}=${folder}`);
    }
  }
  await docker('exec', '--user', '0', name, 'sh', '-c', setup);
  await sh(['sh', '-c', 'docker save "$0" | docker exec -i "$1" docker load', image, name]);
  // act reads the secrets from a FIFO, so no file in the container holds them.
  const fill = ['docker', 'exec', '-i', name, 'sh', '-c', `cat > ${home}/lci/secrets`];
  const feed = quiet(sh(fill, dotenv({ GITHUB_TOKEN: request.token, ...secrets })));
  const minutes = Math.min(plan.timeout ?? limits.timeout_minutes, limits.timeout_minutes);
  let stopped: 'timeout' | 'cancelled' | undefined;
  function stop(why: 'timeout' | 'cancelled') {
    stopped ??= why;
    void quiet(docker('rm', '-f', '-v', name));
  }
  const timer = setTimeout(() => stop('timeout'), minutes * 60_000);
  request.signal.addEventListener('abort', () => stop('cancelled'));
  if (request.signal.aborted) {
    stop('cancelled');
  }
  const args = [
    ['--workflows', `.github/workflows/${plan.file}`, '--job', job, '--actor', pull.user.login],
    ['--eventpath', `${home}/lci/event.json`, '--secret-file', `${home}/lci/secrets`],
    ['--var-file', `${home}/lci/vars`, '--artifact-server-path', `${home}/artifacts`],
    ['--action-offline-mode', '--pull=false', '--bind'],
    ['--env', `GITHUB_RUN_ID=${id}`, '--env', 'GITHUB_RUN_ATTEMPT=1'],
    plan.labels.flatMap((runsOn) => ['--platform', `${runsOn}=${image}`]),
    local,
  ].flat();
  const merged = ['sh', '-c', 'exec "$@" 2>&1', 'sh', 'act', 'pull_request', ...args];
  const act = Bun.spawn(['docker', 'exec', '--workdir', work, name, ...merged], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
  });
  await mkdir(path.dirname(request.logFile), { recursive: true });
  const log = createWriteStream(request.logFile);
  const hidden = [request.token, ...Object.values(secrets)];
  let succeeded = false;
  let rest = '';
  for await (const chunk of act.stdout.pipeThrough(new TextDecoderStream())) {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) {
      succeeded ||= line.includes('Job succeeded');
      log.write(`${redact(line, hidden)}\n`);
    }
  }
  log.end(`${redact(rest, hidden)}\n`);
  const exit = await act.exited;
  clearTimeout(timer);
  await feed;
  if (!stopped) {
    const kept = `${request.logFile.replace(/\.log$/u, '')}-artifacts`;
    await quiet(docker('cp', '--quiet', `${name}:${home}/artifacts`, kept));
  }
  return outcomeOf({ exit, succeeded, seconds: (Date.now() - started) / 1000, stopped, minutes });
}

/**
 * Runs one job of one commit and returns the commit status to post. The job runs
 * in a new container that mounts nothing from the host and holds its own Docker
 * daemon. The container, its volume and the checkout go away when the job ends.
 */
export async function runJob(request: JobRequest): Promise<Outcome> {
  const id = `${Math.floor(Date.now() / 1000)}${String((counter += 1) % 1000).padStart(3, '0')}`;
  const run = path.join(paths.cache, 'runs', id);
  if (request.signal.aborted) {
    return outcomeOf({ exit: 1, succeeded: false, seconds: 0, stopped: 'cancelled', minutes: 0 });
  }
  try {
    const ready = await prepare(request, run, path.join(run, 'work', path.basename(request.repo)));
    if (typeof ready === 'string') {
      return { state: 'error', description: ready };
    }
    return await runAct(request, id, run, ready);
  } finally {
    await quiet(docker('rm', '-f', '-v', `local-ci-${id}`));
    await rm(run, { recursive: true, force: true });
  }
}
