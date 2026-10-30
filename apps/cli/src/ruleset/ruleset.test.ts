import { expect, test } from 'bun:test';

import {
  applyRulesets,
  compareRulesets,
  renderRulesets,
  resolveRuleset,
  rulesetDifferences,
} from '@/ruleset/ruleset';
import type { Gh } from '@/ruleset/ruleset';
import { gitRepo } from '@/testing/git-repo';

const repo = 'acme/shop';

const file = {
  name: 'main',
  bypass_actors: [
    { actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'pull_request' },
    { actor_type: 'Integration', actor_id: 'vars.CLUTCH_APP_ID', bypass_mode: 'always' },
  ],
  rules: [
    { type: 'deletion' },
    {
      type: 'required_status_checks',
      parameters: { required_status_checks: [{ context: 'validate' }, { context: 'sast' }] },
    },
  ],
};

/** A fake `gh`: answers GET routes from `routes`, and records each write. */
function fakeGh(routes: Record<string, unknown>) {
  const writes: Array<Array<string>> = [];
  const gh: Gh = (args) => {
    if (args.includes('-X')) {
      writes.push(args);
      return Promise.resolve({ ok: true, out: '{}', err: '' });
    }
    const answer = routes[args[1]];
    return Promise.resolve(
      answer === undefined
        ? { ok: false, out: '', err: 'gh: Not Found (HTTP 404)' }
        : { ok: true, out: JSON.stringify(answer), err: '' },
    );
  };
  return { gh, writes };
}

test('a bypass actor that names a variable gets its value, or is dropped with a note', async () => {
  const withVar = fakeGh({ [`repos/${repo}/actions/variables/CLUTCH_APP_ID`]: { value: '42' } });
  const resolved = await resolveRuleset(file, repo, withVar.gh);
  expect(resolved.notes).toEqual([]);
  expect(resolved.ruleset.bypass_actors).toContainEqual({
    actor_type: 'Integration',
    actor_id: 42,
    bypass_mode: 'always',
  });
  const without = await resolveRuleset(file, repo, fakeGh({}).gh);
  expect(without.ruleset.bypass_actors).toHaveLength(1);
  expect(without.notes[0]).toContain('CLUTCH_APP_ID is not set');
});

test('differences ignore the defaults GitHub adds and list order, and name missing and extra items', () => {
  const live = {
    id: 7,
    name: 'main',
    rules: [
      {
        type: 'required_status_checks',
        parameters: {
          do_not_enforce_on_create: false,
          required_status_checks: [{ context: 'sast' }, { context: 'validate' }],
        },
      },
      { type: 'deletion' },
    ],
  };
  const want = { name: 'main', rules: file.rules };
  expect(rulesetDifferences(want, live)).toEqual([]);
  const drifted = {
    ...live,
    rules: [
      {
        type: 'required_status_checks',
        parameters: { required_status_checks: [{ context: 'validate' }, { context: 'old' }] },
      },
      { type: 'deletion' },
    ],
  };
  expect(rulesetDifferences(want, drifted)).toEqual([
    'rules[required_status_checks].parameters.required_status_checks: missing sast',
    'rules[required_status_checks].parameters.required_status_checks: extra old',
  ]);
  expect(rulesetDifferences({ enforcement: 'active' }, { enforcement: 'disabled' })).toEqual([
    'enforcement: "disabled", want "active"',
  ]);
});

test('apply creates a missing ruleset with POST and updates one by name with PUT', async () => {
  await using project = await gitRepo(
    { '.github/rulesets/main.json': JSON.stringify(file) },
    { git: false },
  );
  const bodies: Array<string> = [];
  const writeInput = (body: string) => {
    bodies.push(body);
    return Promise.resolve(`/tmp/body-${bodies.length}.json`);
  };
  const variable = { [`repos/${repo}/actions/variables/CLUTCH_APP_ID`]: { value: '42' } };
  const empty = fakeGh({ ...variable, [`repos/${repo}/rulesets?per_page=100`]: [] });
  expect(await applyRulesets(project.root, repo, empty.gh, writeInput)).toEqual([
    { file: '.github/rulesets/main.json', name: 'main', action: 'created' },
  ]);
  expect(empty.writes).toEqual([
    ['api', '-X', 'POST', `repos/${repo}/rulesets`, '--input', '/tmp/body-1.json'],
  ]);
  expect(JSON.parse(bodies[0]).bypass_actors[1].actor_id).toBe(42);
  const existing = fakeGh({
    ...variable,
    [`repos/${repo}/rulesets?per_page=100`]: [{ id: 7, name: 'main' }],
    [`repos/${repo}/rulesets/7`]: { id: 7, name: 'main' },
  });
  await applyRulesets(project.root, repo, existing.gh, writeInput);
  expect(existing.writes[0].slice(1, 4)).toEqual(['-X', 'PUT', `repos/${repo}/rulesets/7`]);
});

test('compare reports matches and missing, skips keys the file does not name, and never writes', async () => {
  await using project = await gitRepo(
    { '.github/rulesets/main.json': JSON.stringify(file) },
    { git: false },
  );
  const variable = { [`repos/${repo}/actions/variables/CLUTCH_APP_ID`]: { value: '42' } };
  const live = {
    ...file,
    id: 7,
    bypass_actors: [file.bypass_actors[0], { ...file.bypass_actors[1], actor_id: 42 }],
  };
  const matching = fakeGh({
    ...variable,
    [`repos/${repo}/rulesets?per_page=100`]: [{ id: 7, name: 'main' }],
    [`repos/${repo}/rulesets/7`]: live,
  });
  const states = await compareRulesets(project.root, repo, matching.gh);
  expect(states.map((item) => item.state)).toEqual(['matches']);
  expect(matching.writes).toEqual([]);
  expect(renderRulesets(states)).toBe('Ruleset main: matches .github/rulesets/main.json');
  const missing = fakeGh({ ...variable, [`repos/${repo}/rulesets?per_page=100`]: [] });
  const [absent] = await compareRulesets(project.root, repo, missing.gh);
  expect(absent.state).toBe('missing');
  const drifted = fakeGh({
    ...variable,
    [`repos/${repo}/rulesets?per_page=100`]: [{ id: 7, name: 'main' }],
    [`repos/${repo}/rulesets/7`]: { ...live, enforcement: 'disabled' },
  });
  const [unnamed] = await compareRulesets(project.root, repo, drifted.gh);
  expect(unnamed.state).toBe('matches');
});
