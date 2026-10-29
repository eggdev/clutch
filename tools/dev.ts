import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/**
 * The one way to start the dev servers: `mise exec -- bun run dev`. Each app
 * with an Nx `dev` target runs through portless, at a stable name such as
 * `http://<project>.localhost:1355`. A server that already answers is used
 * again, and only a missing one starts. A lock file stops two runs from
 * starting the same server. `--check` prints the state and exits 1 when a
 * server is down. See docs/contributing/setup/local-development.md.
 */

export type DevApp = {
  readonly folder: string;
  readonly name: string;
  readonly command: ReadonlyArray<string>;
  readonly health: string;
};

/** Plain HTTP on port 1355 needs no sudo and no trusted certificate. */
export const portlessDefaults = { PORTLESS_PORT: '1355', PORTLESS_HTTPS: '0' };

/**
 * The apps under `apps/` with an Nx `dev` target. The `web` app gets the bare
 * project name. Any other app gets `<app>.<project>`. A server app, tagged
 * `platform:server`, answers `/health`. Any other app answers `/`.
 */
export function devApps(root: string): Array<DevApp> {
  const project = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8')).name;
  const apps = path.join(root, 'apps');
  if (!existsSync(apps)) {
    return [];
  }
  return readdirSync(apps, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const file = path.join(apps, entry.name, 'package.json');
      if (!existsSync(file)) {
        return [];
      }
      const manifest = JSON.parse(readFileSync(file, 'utf-8'));
      const command: string | undefined = manifest.nx?.targets?.dev?.options?.command;
      if (!command) {
        return [];
      }
      const server = (manifest.nx?.tags ?? []).includes('platform:server');
      return [
        {
          folder: `apps/${entry.name}`,
          name: entry.name === 'web' ? project : `${entry.name}.${project}`,
          command: command.split(/\s+/u),
          health: server ? '/health' : '/',
        },
      ];
    });
}

/**
 * Whether the app at `url` answers its health path. The request goes to the
 * proxy on 127.0.0.1 with the app's host name, so no DNS lookup is needed.
 */
export async function isUp(url: string, health: string): Promise<boolean> {
  const target = new URL(url);
  try {
    const response = await fetch(`${target.protocol}//127.0.0.1:${target.port}${health}`, {
      // A dev server such as Vite answers `/` only for a request that accepts HTML.
      headers: { host: target.host, accept: 'text/html,application/json' },
      signal: AbortSignal.timeout(2000),
    });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Takes the lock file. When a live process holds it, waits for that process to
 * finish its starts. A lock from a process that has ended is taken over.
 */
export async function acquireLock(file: string, timeoutMs = 120_000): Promise<() => void> {
  mkdirSync(path.dirname(file), { recursive: true });
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      writeFileSync(file, String(process.pid), { flag: 'wx' });
      return () => {
        if (existsSync(file)) {
          unlinkSync(file);
        }
      };
    } catch {
      const holder = Number(readFileSync(file, 'utf-8'));
      if (!isAlive(holder)) {
        unlinkSync(file);
      } else if (Date.now() > until) {
        throw new Error(`Another dev run (PID ${holder}) holds ${file}. Wait for it, or stop it.`);
      } else {
        await Bun.sleep(250);
      }
    }
  }
}

function pick(env: NodeJS.ProcessEnv, keys: ReadonlyArray<string>): Record<string, string> {
  return Object.fromEntries(keys.flatMap((key) => (env[key] ? [[key, env[key]]] : [])));
}

const portless = (root: string) => path.join(root, 'node_modules/.bin/portless');
const portlessEnv = () => ({
  ...portlessDefaults,
  ...pick(process.env, Object.keys(portlessDefaults)),
});

/** The URL that portless gives a name, with the worktree prefix it adds in a linked worktree. */
export function urlOf(root: string, name: string): string {
  const run = Bun.spawnSync([portless(root), 'get', name], {
    cwd: root,
    env: { ...process.env, ...portlessEnv() },
  });
  const url = run.stdout.toString().trim();
  if (run.exitCode !== 0 || !URL.canParse(url)) {
    throw new Error(`portless get ${name} failed: ${run.stderr.toString().trim()}`);
  }
  return url;
}

async function waitUntilUp(url: string, health: string, child: Bun.Subprocess): Promise<void> {
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) {
      throw new Error(`${url} stopped while it started (exit ${child.exitCode}).`);
    }
    if (await isUp(url, health)) {
      return;
    }
    await Bun.sleep(500);
  }
  throw new Error(`${url} did not answer ${health} within 120 seconds.`);
}

async function main(root: string, check: boolean): Promise<number> {
  const apps = devApps(root);
  const urls = new Map(apps.map((app) => [app.name, urlOf(root, app.name)]));
  const urlFor = (folder: string) =>
    urls.get(apps.find((app) => app.folder === folder)?.name ?? '');
  const state = () =>
    Promise.all(
      apps.map(async (app) => ({ app, up: await isUp(urls.get(app.name) ?? '', app.health) })),
    );
  if (check) {
    const now = await state();
    for (const { app, up } of now) {
      console.log(`${up ? 'up  ' : 'down'}  ${urls.get(app.name)}  (${app.folder})`);
    }
    return now.every(({ up }) => up) ? 0 : 1;
  }
  const release = await acquireLock(path.join(root, '.data/dev.lock'));
  const children: Array<Bun.Subprocess> = [];
  // A stop signal reaches the servers that this run started, also while they start.
  const stop = () => {
    for (const child of children) {
      child.kill('SIGINT');
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    for (const { app, up } of await state()) {
      const url = urls.get(app.name) ?? '';
      if (up) {
        console.log(`reused   ${url}  (${app.folder})`);
        continue;
      }
      // The web app proxies the sync socket to the API, and the API accepts
      // the web app's origin.
      const links = pick(
        { DEV_API_URL: urlFor('apps/api'), SYNC_ORIGINS: urlFor('apps/web') },
        app.folder === 'apps/web' ? ['DEV_API_URL'] : ['SYNC_ORIGINS'],
      );
      const child = Bun.spawn([portless(root), 'run', '--name', app.name, ...app.command], {
        cwd: path.join(root, app.folder),
        env: { ...process.env, ...portlessEnv(), ...links },
        stdout: 'inherit',
        stderr: 'inherit',
      });
      children.push(child);
      await waitUntilUp(url, app.health, child);
      console.log(`started  ${url}  (${app.folder})`);
    }
  } catch (error) {
    for (const child of children) {
      child.kill();
    }
    throw error;
  } finally {
    release();
  }
  if (children.length === 0) {
    console.log('Every dev server already runs. Nothing started.');
    return 0;
  }
  const codes = await Promise.all(children.map((child) => child.exited));
  return codes.find((code) => code !== 0) ?? 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.cwd(), process.argv.includes('--check'));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
