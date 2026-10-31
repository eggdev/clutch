import type { Clock } from '@tools/github/github';
import type { Result, Run } from '@tools/github/stack';

/**
 * A fake runner for `gh` and `git`. Each answer matches a command by prefix,
 * the first match wins, and a list of answers is used in turn. Calls are kept.
 */
export function fake(answers: Array<[string, Partial<Result> | Array<Partial<Result>>]>) {
  const calls: Array<string> = [];
  const used = new Map<string, number>();
  const run: Run = (command) => {
    const line = command.join(' ');
    calls.push(line);
    const found = answers.find(([prefix]) => line.startsWith(prefix));
    let answer: Partial<Result> = {};
    if (found) {
      const [prefix, value] = found;
      const index = used.get(prefix) ?? 0;
      used.set(prefix, index + 1);
      answer = Array.isArray(value) ? (value[Math.min(index, value.length - 1)] ?? {}) : value;
    }
    return Promise.resolve({ ok: true, out: '', err: '', ...answer });
  };
  return { run, calls };
}

/** A clock that moves forward on each sleep and never waits. */
export function fakeClock(): Clock & { slept: number } {
  const clock = {
    slept: 0,
    now: () => clock.slept,
    sleep: (ms: number) => {
      clock.slept += ms;
      return Promise.resolve();
    },
  };
  return clock;
}

export const noWrite = () => Promise.resolve();
export const trunk: [string, Partial<Result>] = ['gh repo view', { out: 'main\n' }];
