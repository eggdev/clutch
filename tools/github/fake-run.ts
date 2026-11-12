import type { Clock } from '@tools/github/github';
import type { Result, Run } from '@tools/github/stack';
import { ownerLogin } from '@tools/github/status';

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
    } else if (line.endsWith(' --jq .title')) {
      // A PR's title, unless the test names one: a plain title, so no test is a major change by accident.
      answer = { out: 'fix: a small change\n' };
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

/** The "Owner review needed" annotations of the latest agent-review run on `sha`, as auto-merge reads them. */
export const findingsOn = (
  sha: string,
  messages: Array<string>,
): Array<[string, Partial<Result>]> => [
  [`gh api repos/{owner}/{repo}/commits/${sha}/check-runs`, { out: messages.length ? '42' : '' }],
  ['gh api repos/{owner}/{repo}/check-runs/42/annotations', { out: messages.join('\n') }],
];

/** A review as `merge` and `status` read it from the pulls reviews API. */
export type Reviewed = { login: string; state: string; commit: string };

/** The reviews on PR `number`, oldest first. */
export const reviewsOf = (
  number: string,
  ...reviews: Array<Reviewed>
): [string, Partial<Result>] => [
  `gh api --paginate repos/{owner}/{repo}/pulls/${number}/reviews`,
  { out: reviews.map((review) => JSON.stringify(review)).join('\n') },
];

/** The owner's login, from clutch.yaml or CODEOWNERS, so the tests follow the repository. */
export async function repoOwner() {
  const login = await ownerLogin();
  if (!login) {
    throw new Error('This repository names no owner to test against.');
  }
  return login;
}
