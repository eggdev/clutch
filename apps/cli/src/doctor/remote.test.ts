import { expect, test } from 'bun:test';

import { remoteProber } from '@/doctor/remote';
import type { Gh } from '@/doctor/remote';

/** A fake `gh`. It answers `api <route>` from `routes`, records each call, and fails on anything else. */
function fakeGh(routes: Record<string, unknown | number>) {
  const calls: Array<Array<string>> = [];
  const gh: Gh = (args) => {
    calls.push(args);
    const answer = routes[args[1]];
    if (typeof answer === 'number') {
      return Promise.resolve({ ok: false, out: '', err: `gh: Not Found (HTTP ${answer})` });
    }
    return Promise.resolve(
      answer === undefined
        ? { ok: false, out: '', err: 'gh: Could not resolve to a Repository' }
        : { ok: true, out: JSON.stringify(answer), err: '' },
    );
  };
  return { gh, calls };
}

const repo = 'acme/shop';

async function outcomeOf(probe: ReturnType<typeof remoteProber>, name: string) {
  const result = await probe(name);
  return result.outcome;
}
const settings = (extra: object = {}) => ({ default_branch: 'main', ...extra });
const ruleset = [
  { type: 'pull_request' },
  {
    type: 'required_status_checks',
    parameters: { required_status_checks: [{ context: 'validate' }] },
  },
  { type: 'merge_queue' },
];

test('a ruleset with pull requests and the validate check protects main', async () => {
  const { gh, calls } = fakeGh({
    [`repos/${repo}`]: settings(),
    [`repos/${repo}/rules/branches/main`]: ruleset,
    [`repos/${repo}/branches/main/protection`]: 404,
  });
  const probe = remoteProber({ root: '.', repo, gh });
  expect(await outcomeOf(probe, 'protected_main')).toBe('pass');
  expect(await outcomeOf(probe, 'merge_queue')).toBe('pass');
  expect(await outcomeOf(probe, 'required_check:validate')).toBe('pass');
  expect(await outcomeOf(probe, 'required_check:agent-review')).toBe('fail');
  expect(calls.filter((args) => args[1] === `repos/${repo}`)).toHaveLength(1);
});

test('classic branch protection counts, and a 404 means main is not protected', async () => {
  const protectedRepo = fakeGh({
    [`repos/${repo}`]: settings(),
    [`repos/${repo}/rules/branches/main`]: [],
    [`repos/${repo}/branches/main/protection`]: {
      required_pull_request_reviews: {},
      required_status_checks: { contexts: ['validate'] },
    },
  });
  expect(
    await outcomeOf(remoteProber({ root: '.', repo, gh: protectedRepo.gh }), 'protected_main'),
  ).toBe('pass');

  const open = fakeGh({
    [`repos/${repo}`]: settings(),
    [`repos/${repo}/rules/branches/main`]: [],
    [`repos/${repo}/branches/main/protection`]: 404,
  });
  expect(await outcomeOf(remoteProber({ root: '.', repo, gh: open.gh }), 'protected_main')).toBe(
    'fail',
  );
});

test('security settings pass when enabled, fail when disabled, and are unknown when hidden', async () => {
  const enabled = fakeGh({
    [`repos/${repo}`]: settings({
      security_and_analysis: {
        secret_scanning: { status: 'enabled' },
        secret_scanning_push_protection: { status: 'disabled' },
      },
      allow_auto_merge: true,
    }),
  });
  const probe = remoteProber({ root: '.', repo, gh: enabled.gh });
  expect(await outcomeOf(probe, 'secret_scanning')).toBe('pass');
  expect(await outcomeOf(probe, 'push_protection')).toBe('fail');
  expect(await outcomeOf(probe, 'allow_auto_merge')).toBe('pass');

  const hidden = fakeGh({ [`repos/${repo}`]: settings() });
  const blind = remoteProber({ root: '.', repo, gh: hidden.gh });
  expect(await blind('secret_scanning')).toEqual({
    outcome: 'unknown',
    evidence: ['secret_scanning is not visible to this token'],
  });
  expect(await outcomeOf(blind, 'allow_auto_merge')).toBe('unknown');
});

test('a 403, a failed gh and an unknown probe are unknown, never missing', async () => {
  const forbidden = fakeGh({
    [`repos/${repo}`]: settings(),
    [`repos/${repo}/code-scanning/default-setup`]: 403,
  });
  const probe = remoteProber({ root: '.', repo, gh: forbidden.gh });
  expect(await outcomeOf(probe, 'code_scanning_default_setup')).toBe('unknown');
  expect(await outcomeOf(probe, 'branch_names')).toBe('unknown');
  const broken = fakeGh({});
  expect(await outcomeOf(remoteProber({ root: '.', repo, gh: broken.gh }), 'protected_main')).toBe(
    'unknown',
  );
});

test('every probe only reads: gh never gets a method, a field or an input', async () => {
  const { gh, calls } = fakeGh({
    [`repos/${repo}`]: settings({ security_and_analysis: {}, allow_auto_merge: false }),
    [`repos/${repo}/rules/branches/main`]: [],
    [`repos/${repo}/branches/main/protection`]: 404,
    [`repos/${repo}/code-scanning/default-setup`]: { state: 'not-configured' },
  });
  const probe = remoteProber({ root: '.', repo, gh });
  for (const name of [
    'protected_main',
    'secret_scanning',
    'push_protection',
    'merge_queue',
    'allow_auto_merge',
    'code_scanning_default_setup',
    'required_check:validate',
  ]) {
    await probe(name);
  }
  const writes = calls
    .flat()
    .filter((arg) => /^(-X|--method|-f|-F|--field|--raw-field|--input)$/u.test(arg));
  expect(writes).toEqual([]);
  expect(calls.every((args) => args.length === 2 && args[0] === 'api')).toBe(true);
});

test('actions_secret passes on any named secret, fails on none, and is unknown without access', async () => {
  const secrets = (names: Array<string>) => ({
    [`repos/${repo}/actions/secrets?per_page=100`]: { secrets: names.map((name) => ({ name })) },
  });
  const has = remoteProber({
    root: '.',
    repo,
    gh: fakeGh(secrets(['CLAUDE_CODE_OAUTH_TOKEN'])).gh,
  });
  expect(await outcomeOf(has, 'actions_secret:ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN')).toBe(
    'pass',
  );
  const none = remoteProber({ root: '.', repo, gh: fakeGh(secrets(['OTHER'])).gh });
  expect(await outcomeOf(none, 'actions_secret:ANTHROPIC_API_KEY')).toBe('fail');
  const denied = remoteProber({
    root: '.',
    repo,
    gh: fakeGh({ [`repos/${repo}/actions/secrets?per_page=100`]: 403 }).gh,
  });
  expect(await outcomeOf(denied, 'actions_secret:ANTHROPIC_API_KEY')).toBe('unknown');
});

test('bot_review passes when a named bot reviewed or commented on a recent pull request', async () => {
  const routes = {
    [`repos/${repo}/pulls?state=all&per_page=10`]: [{ number: 7 }, { number: 8 }],
    [`repos/${repo}/pulls/7/reviews`]: [{ user: { login: 'brendan' } }],
    [`repos/${repo}/issues/7/comments`]: [],
    [`repos/${repo}/pulls/8/reviews`]: [],
    [`repos/${repo}/issues/8/comments`]: [{ user: { login: 'coderabbitai[bot]' } }],
  };
  const probe = remoteProber({ root: '.', repo, gh: fakeGh(routes).gh });
  expect(await outcomeOf(probe, 'bot_review:cursor|coderabbitai')).toBe('pass');
  expect(await outcomeOf(probe, 'bot_review:cursor')).toBe('fail');
});
