import { buildMachineOf, remote, spawnRunner } from '@tools/native/build-machine';
import type { BuildMachine, Runner } from '@tools/native/build-machine';
import { DeviceHostError } from '@tools/native/device-host';

// A pool device runs on the build machine, so it cannot reach the dev servers of this machine
// by a `localhost` name. A simulator shares the network of its Mac, and the Mac resolves each
// `*.localhost` name to itself. So a forward of the dev proxy port from the build machine to
// this machine makes each dev server answer there at its own URL.
// See docs/contributing/setup/native.md#the-dev-server-link.

/** A dev server of this machine: its URL and the path that answers when it is up. */
export type DevServer = { readonly url: string; readonly health: string };

export type LinkOptions = {
  readonly log: (line: string) => void;
  readonly machine?: () => BuildMachine;
  readonly runner?: Pick<Runner, 'capture'>;
};

/** The one port of the dev proxy, which each dev server URL carries. */
function portOf(servers: ReadonlyArray<DevServer>): string {
  const ports = new Set(
    servers.map(({ url }) => {
      const parsed = new URL(url);
      return parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    }),
  );
  const [port] = ports;
  if (ports.size !== 1 || port === undefined) {
    throw new DeviceHostError(
      `The dev servers answer on the ports ${[...ports].join(', ')}, and the link forwards one port. Run each dev server behind the dev proxy, with \`mise exec -- bun run dev\`.`,
    );
  }
  return port;
}

/** The URLs that do not answer their health path on the build machine. */
async function unreachable(
  servers: ReadonlyArray<DevServer>,
  ssh: string,
  runner: Pick<Runner, 'capture'>,
): Promise<Array<string>> {
  const results = await Promise.all(
    servers.map(async ({ url, health }) => {
      const target = new URL(health, url).href;
      // The URL goes in single quotes of the remote shell, so it may hold none.
      const probe = await runner.capture(
        remote(ssh, `curl -sf -o /dev/null -m 5 ${target.replaceAll("'", '%27')}`),
      );
      return probe.code === 0 ? null : url;
    }),
  );
  return results.filter((url) => url !== null);
}

/**
 * Makes each dev server of this machine answer on the build machine. A probe
 * from the build machine comes first, and a forward starts only when a server
 * does not answer. The forward runs in the background and stays up for the
 * next run. The messages name no machine.
 */
export async function linkDevServers(
  servers: ReadonlyArray<DevServer>,
  options: LinkOptions,
): Promise<void> {
  if (servers.length === 0) {
    return;
  }
  const port = portOf(servers);
  const { ssh } = (options.machine ?? buildMachineOf)();
  const runner = options.runner ?? spawnRunner;
  const before = await unreachable(servers, ssh, runner);
  if (before.length === 0) {
    return;
  }
  options.log(
    `Forwarding port ${port} of the build machine to the dev servers of this machine. The forward stays up for the next run.`,
  );
  const forward = await runner.capture([
    'ssh',
    '-f',
    '-N',
    '-o',
    'BatchMode=yes',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=30',
    '-R',
    `${port}:127.0.0.1:${port}`,
    ssh,
  ]);
  if (forward.code !== 0) {
    throw new DeviceHostError(
      `The build machine could not forward port ${port} to this machine: ${forward.stderr.trim()}. Another machine may hold that port.`,
    );
  }
  const [down] = await unreachable(servers, ssh, runner);
  if (down !== undefined) {
    throw new DeviceHostError(
      `The build machine cannot reach ${down}. Start the dev servers with \`mise exec -- bun run dev\`, then run the command again.`,
    );
  }
}
