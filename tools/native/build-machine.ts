import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { DeviceHostError } from '@tools/native/device-host';

// The build machine is a Mac with Xcode, over ssh. It keeps each iOS simulator build by native
// fingerprint. See docs/contributing/setup/native.md#the-build-machine.

/** The build machine of this machine: its ssh name and the folder that holds the builds of each project. */
export type BuildMachine = { readonly ssh: string; readonly root: string };

/** Where the setting is: `$XDG_CONFIG_HOME/clutch/build-machine.json`, or `~/.config/clutch/build-machine.json`. */
export function settingFile(env: NodeJS.ProcessEnv = process.env): string {
  const config = env['XDG_CONFIG_HOME'] || path.join(homedir(), '.config');
  return path.join(config, 'clutch', 'build-machine.json');
}

const readText = (file: string) => (existsSync(file) ? readFileSync(file, 'utf-8') : null);

/** Whether a value is text that is safe in a shell command with no quotes. */
const safe = (part: unknown): part is string =>
  typeof part === 'string' && /^[A-Za-z0-9._/@-]+$/u.test(part);

function parsed(text: string | null): { readonly ssh?: unknown; readonly root?: unknown } {
  try {
    const value: unknown = JSON.parse(text ?? 'null');
    return typeof value === 'object' && value !== null ? value : {};
  } catch {
    return {};
  }
}

/** Reads the setting. `read` returns the text of a file, or null when it does not exist. */
export function buildMachineOf(
  env: NodeJS.ProcessEnv = process.env,
  read: (file: string) => string | null = readText,
): BuildMachine {
  const file = settingFile(env);
  const { ssh, root } = parsed(read(file));
  if (!safe(ssh) || !safe(root) || !path.isAbsolute(root)) {
    throw new DeviceHostError(
      `This machine names no build machine, so it cannot make a native build. Write \`${file}\` with the ssh name of the Mac that has Xcode and the folder for its builds: \`{ "ssh": "<host>", "root": "<absolute folder>" }\`. See docs/contributing/setup/native.md#the-build-machine.`,
    );
  }
  return { ssh, root };
}

/** The name of the project: the `name` of the root package.json, without a scope. */
export function projectOf(root: string): string {
  const { name } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
    name?: unknown;
  };
  const project = typeof name === 'string' ? name.replace(/^@[^/]+\//u, '') : '';
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(project)) {
    throw new DeviceHostError(
      'The `name` in package.json is not a plain lowercase name, so it cannot name the project folder on the build machine.',
    );
  }
  return project;
}

/** Every process that the module starts goes through this, so a test needs no ssh and no git. */
export type Runner = {
  /** Runs one command. `stdin` is the text that it reads. */
  readonly capture: (
    argv: ReadonlyArray<string>,
    options?: { cwd?: string; stdin?: string },
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** Runs `from | to`, passes each chunk of the output of `to` to `log`, and returns its last output line. The code is that of `to`, or of `from` when `to` exits 0. */
  readonly pipe: (
    from: ReadonlyArray<string>,
    to: ReadonlyArray<string>,
    options: { cwd: string; log?: (chunk: string) => void },
  ) => Promise<{ code: number; lastLine: string; stderr: string }>;
};

const spawnRunner: Runner = {
  capture: async (argv, options = {}) => {
    const child = Bun.spawn([...argv], {
      cwd: options.cwd,
      stdin: options.stdin === undefined ? 'ignore' : new Blob([options.stdin]),
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { code, stdout, stderr };
  },
  pipe: async (from, to, options) => {
    const source = Bun.spawn([...from], { cwd: options.cwd, stderr: 'inherit' });
    const sink = Bun.spawn([...to], { cwd: options.cwd, stdin: source.stdout, stderr: 'pipe' });
    const stderr = new Response(sink.stderr).text();
    let tail = '';
    for await (const chunk of sink.stdout.pipeThrough(new TextDecoderStream())) {
      options.log?.(chunk);
      tail = `${tail}${chunk}`.slice(-400);
    }
    const [code, sourceCode, problem] = await Promise.all([sink.exited, source.exited, stderr]);
    const lastLine = tail.split('\n').findLast((line) => line.trim() !== '') ?? '';
    return { code: code === 0 ? sourceCode : code, lastLine: lastLine.trim(), stderr: problem };
  },
};

/** What `findOrMakeBuild` needs to find or make one build. */
export type BuildRequest = {
  readonly root: string;
  readonly app: string;
  readonly platform: 'ios' | 'android';
  readonly fingerprint: string;
  readonly log: (line: string) => void;
  readonly machine?: () => BuildMachine;
  readonly runner?: Runner;
};

/** The built app of a fingerprint in `tmp/native/<fingerprint>/` of the repository, or null. */
export function cachedApp(root: string, fingerprint: string): string | null {
  const folder = path.join(root, 'tmp/native', fingerprint);
  const app = existsSync(folder)
    ? readdirSync(folder).find((name) => name.endsWith('.app'))
    : undefined;
  return app ? path.join(folder, app) : null;
}

/** A command on the build machine. A login shell has Homebrew and mise, as a terminal there has them. */
const remote = (to: string, cmd: string) => ['ssh', '-o', 'BatchMode=yes', to, `zsh -lc '${cmd}'`];

/** Builds the head commit on the build machine. The build machine gets a snapshot from Git, so the build has only committed changes. */
async function makeBuild(request: BuildRequest, runner: Runner, ssh: string, folder: string) {
  const { root, app, fingerprint, log } = request;
  const head = await runner.capture(['git', 'rev-parse', 'HEAD'], { cwd: root });
  const revision = head.stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(revision)) {
    throw new DeviceHostError(`Cannot read the head commit: ${head.stderr.trim()}`);
  }
  const script = readFileSync(path.join(root, 'tools/native/ios-simulator-build.sh'), 'utf-8');
  const sent = await runner.capture(
    remote(ssh, `mkdir -p ${folder}/bin && cat > ${folder}/bin/ios-simulator-build.sh`),
    { cwd: root, stdin: script },
  );
  if (sent.code !== 0) {
    throw new DeviceHostError(`ssh ${ssh} failed: ${sent.stderr.trim()}`);
  }
  log(
    `Building ${revision.slice(0, 8)} on the build machine. A first build takes about 5 minutes. Its output follows.`,
  );
  const build = await runner.pipe(
    ['git', 'archive', '--format=tar', revision],
    remote(ssh, `exec bash ${folder}/bin/ios-simulator-build.sh ${folder} ${app} ${revision}`),
    { cwd: root, log },
  );
  if (build.code !== 0) {
    throw new DeviceHostError(
      build.code === 75
        ? 'Another build of this project runs on the build machine. Wait for it, then run the command again.'
        : `The build on the build machine failed (exit ${build.code}). Read its output above.`,
    );
  }
  if (build.lastLine !== fingerprint) {
    throw new DeviceHostError(
      `The head commit has the native fingerprint ${build.lastLine.slice(0, 8)}, and this checkout has ${fingerprint.slice(0, 8)}. The build is of the commit, so a native change that no commit holds is not in it. Commit each native change, then run the command again.`,
    );
  }
}

/** Copies the build here. It unpacks beside the final folder and renames it when whole, so a copy that stops halfway leaves no app. */
async function copyBuild(request: BuildRequest, runner: Runner, ssh: string, folder: string) {
  const { root, fingerprint } = request;
  const target = path.join(root, 'tmp/native', fingerprint);
  const partial = `${target}.partial`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  // The archive leaves out the Mac's own file attributes, which a tar on Linux does not know.
  const copied = await runner.pipe(
    remote(
      ssh,
      `COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -C ${folder}/artifacts/${fingerprint} -cf - .`,
    ),
    ['tar', '-xf', '-', '-C', partial],
    { cwd: root },
  );
  if (copied.code !== 0) {
    rmSync(partial, { recursive: true, force: true });
    throw new DeviceHostError(`Could not copy the build here: ${copied.stderr.trim()}`);
  }
  rmSync(target, { recursive: true, force: true });
  renameSync(partial, target);
  const app = cachedApp(root, fingerprint);
  if (app === null) {
    throw new DeviceHostError(
      `The build of fingerprint ${fingerprint.slice(0, 8)} on the build machine holds no app.`,
    );
  }
  return app;
}

/** The path of the built app on this machine, after it is found or made. */
export async function findOrMakeBuild(request: BuildRequest): Promise<string> {
  const { root, app, fingerprint } = request;
  if (request.platform === 'android') {
    throw new DeviceHostError(
      'The build machine makes no Android build yet. The template ships iOS only.',
    );
  }
  if (!/^[0-9a-f]{40}$/u.test(fingerprint) || !/^[a-z0-9][a-z0-9-]*$/u.test(app)) {
    throw new DeviceHostError('A build needs a 40-character fingerprint and a plain app name.');
  }
  const cached = cachedApp(root, fingerprint);
  if (cached !== null) {
    return cached;
  }
  const { ssh, root: machineRoot } = (request.machine ?? buildMachineOf)();
  const runner = request.runner ?? spawnRunner;
  const folder = `${machineRoot}/${projectOf(root)}`;
  const found = await runner.capture(remote(ssh, `test -d ${folder}/artifacts/${fingerprint}`), {
    cwd: root,
  });
  // ssh exits 255 for its own failure, and with the status of `test` otherwise.
  if (found.code === 255) {
    throw new DeviceHostError(`ssh ${ssh} failed: ${found.stderr.trim()}`);
  }
  if (found.code !== 0) {
    await makeBuild(request, runner, ssh, folder);
  }
  return copyBuild(request, runner, ssh, folder);
}
