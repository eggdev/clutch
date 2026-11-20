import { expect, test } from 'bun:test';

import type { Pull } from '@/plan';
import { distrust, dotenv, outcomeOf, parseEnv, planJob, redact } from '@/plan';

const sha = 'a'.repeat(40);
const authors = ['eggdev', 'eggdev-clutch-bot[bot]'];

function pull(login: string, head: Pull['head']['repo'], commit = sha): Pull {
  return {
    number: 7,
    draft: false,
    user: { login },
    head: { sha: commit, repo: head },
    base: { repo: {} },
  };
}

test('only a pull request from the watched repository by an allowed author is trusted', () => {
  const own = { full_name: 'eggdev/clutch', fork: false };
  expect(distrust('eggdev/clutch', pull('eggdev', own), authors)).toBeNull();
  expect(distrust('eggdev/clutch', pull('eggdev-clutch-bot[bot]', own), authors)).toBeNull();
  expect(distrust('eggdev/clutch', pull('mallory', own), authors)).toContain('allowlist');
  const fork = { full_name: 'mallory/clutch', fork: true };
  expect(distrust('eggdev/clutch', pull('eggdev', fork), authors)).toContain('not in the watched');
  expect(distrust('eggdev/clutch', pull('eggdev', null), authors)).toContain('not in the watched');
  expect(distrust('eggdev/clutch', pull('eggdev', own, 'main; rm ~'), authors)).toContain('id');
});

const ci = `
on: { pull_request: {}, push: { branches: [main] } }
env: { SHARED: "\${{ secrets.SHARED_KEY }}" }
jobs:
  validate:
    runs-on: ubuntu-26.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@${sha}
      - uses: github/codeql-action/init@${sha}
      - uses: docker://semgrep/semgrep:1
      - run: deploy
        env: { A: "\${{ secrets.NEON_API_KEY }}", B: "\${{ secrets.GITHUB_TOKEN }}", C: "\${{ secrets['OTHER'] }}" }
`;

test('a plan names the workflow file, the secrets, the pinned actions and the timeout of a job', () => {
  const nightly = 'on: schedule\njobs: { validate: { runs-on: other, steps: [] } }';
  const files = { 'a-nightly.yml': nightly, 'b-broken.yml': '{', 'ci.yml': ci };
  expect(planJob(files, 'validate')).toEqual({
    file: 'ci.yml',
    secrets: ['SHARED_KEY', 'NEON_API_KEY', 'OTHER'],
    actions: [
      { name: `actions-checkout@${sha}`, repo: 'actions/checkout', ref: sha },
      { name: `github-codeql-action-init@${sha}`, repo: 'github/codeql-action', ref: sha },
    ],
    labels: ['ubuntu-26.04'],
    timeout: 30,
  });
  expect(planJob({ 'ci.yml': ci }, 'journeys')).toBeNull();
});

test('the end of a run becomes one commit status', () => {
  const run = { exit: 0, succeeded: true, seconds: 192, minutes: 30 };
  expect(outcomeOf(run)).toEqual({ state: 'success', description: 'Passed in 3m 12s' });
  expect(outcomeOf({ ...run, exit: 1, seconds: 9 }).description).toBe('Failed in 9s');
  expect(outcomeOf({ ...run, succeeded: false }).skipped).toBe(true);
  expect(outcomeOf({ ...run, exit: 137, stopped: 'timeout' }).description).toContain('30 min');
  expect(outcomeOf({ ...run, exit: 137, stopped: 'cancelled' }).cancelled).toBe(true);
});

test('a log line never shows a secret value, and a short value hides nothing', () => {
  expect(redact('it is hunter2-hunter2 ok', ['hunter2-hunter2', '', 'ok'])).toBe('it is *** ok');
});

test('a secrets file keeps an empty value, and the file for act quotes each value', () => {
  const read = parseEnv('# note\nKEY=abc=def\nNX_TOKEN=\n bad line\n');
  expect(read).toEqual({ KEY: 'abc=def', NX_TOKEN: '' });
  expect(dotenv({ A: '["x"] $HOME', B: "it's\n$1" })).toBe(`A='["x"] $HOME'\nB="it's\\n\\$1"\n`);
});
