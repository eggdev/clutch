import { buildMachineOf, remote, spawnRunner, sshOptions } from '@tools/native/build-machine';
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

/** Text that a remote shell reads as is inside double quotes, which sit inside single quotes. */
const quotable = (text: string) => !/["$`\\']/u.test(text);

/** The URLs that do not answer their health path on the build machine. */
async function unreachable(
  servers: ReadonlyArray<DevServer>,
  ssh: string,
  runner: Pick<Runner, 'capture'>,
): Promise<Array<string>> {
  const results = await Promise.all(
    servers.map(async ({ url, health }) => {
      const target = new URL(health, url).href;
      if (!quotable(url) || !quotable(health) || !quotable(target)) {
        throw new DeviceHostError(
          `The dev server URL ${url} or its health path ${health} holds a quote, \`$\`, a backtick or \`\\\`, so the probe cannot send it.`,
        );
      }
      const probe = await runner.capture(remote(ssh, `curl -sf -o /dev/null -m 5 "${target}"`));
      return probe.code === 0 ? null : url;
    }),
  );
  return results.filter((url) => url !== null);
}

/** The forward of the dev proxy port from the build machine to this machine. */
function forwardOf(port: string, ssh: string): Array<string> {
  return [
    'ssh',
    '-f',
    '-N',
    ...sshOptions,
    '-o',
    'ExitOnForwardFailure=yes',
    '-R',
    `${port}:127.0.0.1:${port}`,
    ssh,
  ];
}

/**
 * Makes each dev server of this machine answer on the build machine. The link
 * starts its own forward unless this machine already runs it, then probes each
 * server from the build machine. So an answer of another server on that port,
 * such as one of the build machine or of the forward of another machine, never
 * counts. The forward runs in the background and stays up for the next run.
 * The messages name no machine.
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
  const forward = forwardOf(port, ssh);
  // pgrep exits 0 when a process of this machine runs the exact forward command.
  const pattern = `-R ${port}:127\\.0\\.0\\.1:${port} ${ssh.replaceAll('.', '\\.')}$`;
  const running = await runner.capture(['pgrep', '-f', '--', pattern]);
  if (running.code !== 0) {
    options.log(
      `Forwarding port ${port} of the build machine to the dev servers of this machine. The forward stays up for the next run.`,
    );
    // ssh -f keeps the output of the capture open in its background process, so capture would wait
    // for the forward to end. The forward writes its errors to a file, and capture reads only that file.
    const started = await runner.capture([
      'sh',
      '-c',
      'log="$(mktemp)"; "$@" >/dev/null 2>"$log"; code=$?; cat "$log" >&2; rm -f "$log"; exit $code',
      'forward',
      ...forward,
    ]);
    if (started.code !== 0) {
      throw new DeviceHostError(
        `The build machine could not forward port ${port} to this machine: ${started.stderr.trim()}. Another listener holds that port there: the dev servers of the build machine, or the forward of another machine.`,
      );
    }
  }
  const [down] = await unreachable(servers, ssh, runner);
  if (down !== undefined) {
    throw new DeviceHostError(
      `The build machine cannot reach ${down}. Start the dev servers with \`mise exec -- bun run dev\`, then run the command again.`,
    );
  }
}
