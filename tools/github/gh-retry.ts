import type { Clock } from '@tools/github/github';
import { realClock } from '@tools/github/github';
import type { Result, Run } from '@tools/github/stack';

/**
 * Retries a `gh` read when GitHub fails for a moment: a 5xx, no server, a
 * timeout or a reset connection. A write is never retried, because a 5xx on a
 * write may have taken effect. command.ts wraps the runner that auto-merge uses.
 */

/** The waits before the second and the third try, in milliseconds. */
const retryDelays = [2000, 5000];

const transient = [
  /HTTP 5\d\d/u,
  /No server is currently available/u,
  /timeout/iu,
  /connection reset/iu,
];

/** Whether a failed command failed for a moment, so that a retry may succeed. */
export function isTransient(result: Result) {
  const text = `${result.err}\n${result.out}`;
  return transient.some((pattern) => pattern.test(text));
}

const reads = new Set(['pr view', 'pr list', 'repo view', 'run list', 'run view']);

/**
 * Whether `gh api` only reads. It writes with a method other than GET, or with
 * a field, since `gh api` then sends a POST whatever the method says.
 */
function apiReads(args: Array<string>) {
  let method: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (/^(-[fF]|--(raw-)?field(=|$)|--input(=|$))/u.test(arg)) {
      return false;
    }
    const attached = /^(?:-X|--method=)(.+)$/u.exec(arg);
    if (attached) {
      method = attached[1];
    } else if (arg === '-X' || arg === '--method') {
      method = args[++i];
    }
  }
  return method === undefined || method.toUpperCase() === 'GET';
}

/** Whether a command only reads GitHub, so that running it again changes nothing. */
export function isRead(command: Array<string>) {
  if (command[0] !== 'gh') {
    return false;
  }
  const [, group, verb] = command;
  if (group === 'api') {
    return apiReads(command.slice(2));
  }
  return reads.has(`${group} ${verb}`);
}

/**
 * Runs a command. A read that fails for a moment runs again after each delay,
 * so it gets 3 tries at most, and the last failure is the result. A failure
 * that is not transient, or any write, returns at once.
 */
export function withRetry(run: Run, clock: Clock = realClock, delays = retryDelays): Run {
  return async (command, options) => {
    let result = await run(command, options);
    if (!isRead(command)) {
      return result;
    }
    for (const delay of delays) {
      if (result.ok || !isTransient(result)) {
        return result;
      }
      await clock.sleep(delay);
      result = await run(command, options);
    }
    return result;
  };
}
