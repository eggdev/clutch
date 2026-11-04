import { expect, test } from 'bun:test';

import { validateClutchConfig } from '@/clutch-config/schema';

const valid = {
  schemaVersion: 1,
  project: 'shop',
  template: { repo: 'eggdev/clutch', mode: 'sync' },
  capabilities: {
    root_agents_md: 'adopted',
    codeql_sast: {
      status: 'waived',
      reason: 'Lands in CL-102.',
      issue: 'CL-102',
      until: '2027-01-31',
    },
    native_builds: { status: 'n/a', reason: 'The project has no native app.' },
  },
  worktree: {
    root: '../shop.worktrees',
    copy: ['.env.local'],
    setup: ['mise exec -- bun install'],
  },
};

test('a valid file gives the typed config, with the short form expanded', () => {
  expect(validateClutchConfig(valid)).toEqual({
    config: {
      ...valid,
      schemaVersion: 1,
      template: { repo: 'eggdev/clutch', mode: 'sync' },
      capabilities: {
        root_agents_md: { status: 'adopted' },
        codeql_sast: {
          status: 'waived',
          reason: 'Lands in CL-102.',
          issue: 'CL-102',
          until: '2027-01-31',
        },
        native_builds: { status: 'n/a', reason: 'The project has no native app.' },
      },
    },
    errors: [],
  });
});

test('an older file that pins template.commit still loads, and the pin is not read', () => {
  const older = { ...valid, template: { ...valid.template, commit: 'any older pin' } };
  expect(validateClutchConfig(older)).toMatchObject({
    config: { template: { repo: 'eggdev/clutch', mode: 'sync' } },
    errors: [],
  });
  expect(validateClutchConfig(older).config?.template).not.toHaveProperty('commit');
});

test('template.grace_days takes a whole number of days', () => {
  const at = (days: unknown) => ({ ...valid, template: { ...valid.template, grace_days: days } });
  expect(validateClutchConfig(at(7)).config?.template.grace_days).toBe(7);
  expect(validateClutchConfig(at(0)).config?.template.grace_days).toBe(0);
  expect(validateClutchConfig(valid).config?.template).not.toHaveProperty('grace_days');
  for (const bad of [-1, 1.5, '7']) {
    expect(validateClutchConfig(at(bad)).errors).toEqual([
      { path: 'template.grace_days', message: 'Expected a whole number of days, 0 or more.' },
    ]);
  }
});

test('worktree is optional, copy and setup default to empty lists, and check is optional', () => {
  const { worktree: _, ...noWorktree } = valid;
  expect(validateClutchConfig(noWorktree).config?.worktree).toBeUndefined();
  expect(validateClutchConfig({ ...valid, worktree: { root: '../w' } }).config?.worktree).toEqual({
    root: '../w',
    copy: [],
    setup: [],
  });
  expect(
    validateClutchConfig({ ...valid, worktree: { root: '../w', check: 'bun test' } }).config
      ?.worktree,
  ).toEqual({ root: '../w', copy: [], setup: [], check: 'bun test' });
});

const paths = (data: unknown) => validateClutchConfig(data).errors.map((error) => error.path);

test('each top-level and template problem names its YAML path', () => {
  expect(
    paths({
      ...valid,
      schemaVersion: 2,
      project: '',
      repos: [],
      template: { repo: 'clutch', commit: 'abc123', mode: 'copy', branch: 'main' },
    }),
  ).toEqual([
    'repos',
    'schemaVersion',
    'project',
    'template.branch',
    'template.repo',
    'template.mode',
  ]);
  expect(paths({ ...valid, template: 'eggdev/clutch' })).toEqual(['template']);
  expect(paths([1])).toEqual(['']);
});

test('each capability problem names its YAML path', () => {
  expect(
    paths({
      ...valid,
      capabilities: {
        'Bad-Id': 'adopted',
        short_waiver: 'waived',
        unknown_status: 'maybe',
        bad_fields: {
          status: 'waived',
          reason: 'Later.',
          issue: 'ISSUE-1',
          until: '2027-02-30',
          owner: 'x',
        },
        no_reason: { status: 'n/a' },
      },
    }),
  ).toEqual([
    'capabilities.Bad-Id',
    'capabilities.short_waiver.reason',
    'capabilities.unknown_status',
    'capabilities.bad_fields.owner',
    'capabilities.bad_fields.issue',
    'capabilities.bad_fields.until',
    'capabilities.no_reason.reason',
  ]);
});

test('each worktree problem names its YAML path', () => {
  expect(
    paths({ ...valid, worktree: { copy: '.env', setup: [1], check: ' ', extra: true } }),
  ).toEqual([
    'worktree.extra',
    'worktree.root',
    'worktree.copy',
    'worktree.setup',
    'worktree.check',
  ]);
  expect(paths({ ...valid, worktree: { root: '../w', check: ['bun test'] } })).toEqual([
    'worktree.check',
  ]);
});

test('automerge is optional and takes off, dry-run or on', () => {
  expect(validateClutchConfig(valid).config?.automerge).toBeUndefined();
  expect(
    validateClutchConfig({ ...valid, automerge: { mode: 'dry-run' } }).config?.automerge,
  ).toEqual({ mode: 'dry-run' });
  expect(paths({ ...valid, automerge: { mode: 'yes', when: 'low' } })).toEqual([
    'automerge.when',
    'automerge.mode',
  ]);
  expect(paths({ ...valid, automerge: 'on' })).toEqual(['automerge']);
  expect(
    validateClutchConfig({ ...valid, automerge: { mode: 'on', step: 'bots' } }).config?.automerge,
  ).toEqual({ mode: 'on', step: 'bots' });
  expect(paths({ ...valid, automerge: { mode: 'on', step: 'high' } })).toEqual(['automerge.step']);
  expect(
    validateClutchConfig({ ...valid, automerge: { mode: 'dry-run', owner: 'eggdev' } }).config
      ?.automerge,
  ).toEqual({ mode: 'dry-run', owner: 'eggdev' });
  expect(paths({ ...valid, automerge: { mode: 'on', owner: '@eggdev' } })).toEqual([
    'automerge.owner',
  ]);
});

test('autoRevert is optional and takes a watch list of check or job names', () => {
  expect(validateClutchConfig(valid).config?.autoRevert).toBeUndefined();
  expect(validateClutchConfig({ ...valid, autoRevert: {} }).config?.autoRevert).toEqual({
    watch: [],
  });
  expect(
    validateClutchConfig({ ...valid, autoRevert: { watch: ['production'] } }).config?.autoRevert,
  ).toEqual({ watch: ['production'] });
  expect(paths({ ...valid, autoRevert: 'production' })).toEqual(['autoRevert']);
  expect(paths({ ...valid, autoRevert: { watch: 'production' } })).toEqual(['autoRevert.watch']);
  expect(paths({ ...valid, autoRevert: { watch: [1] } })).toEqual(['autoRevert.watch']);
  expect(paths({ ...valid, autoRevert: { watch: ['  '] } })).toEqual(['autoRevert.watch']);
  expect(paths({ ...valid, autoRevert: { watch: [], when: 'red' } })).toEqual(['autoRevert.when']);
});

test('pr is optional and takes a branch prefix', () => {
  expect(validateClutchConfig(valid).config?.pr).toBeUndefined();
  expect(validateClutchConfig({ ...valid, pr: { branchPrefix: 'agent/' } }).config?.pr).toEqual({
    branchPrefix: 'agent/',
  });
  expect(paths({ ...valid, pr: { branchPrefix: 'has space', base: 'main' } })).toEqual([
    'pr.base',
    'pr.branchPrefix',
  ]);
});

test('sast is optional and takes auto, codeql or semgrep', () => {
  expect(validateClutchConfig(valid).config?.sast).toBeUndefined();
  for (const engine of ['auto', 'codeql', 'semgrep'] as const) {
    expect(validateClutchConfig({ ...valid, sast: engine }).config?.sast).toBe(engine);
  }
  expect(paths({ ...valid, sast: 'opengrep' })).toEqual(['sast']);
  expect(paths({ ...valid, sast: { engine: 'codeql' } })).toEqual(['sast']);
});

test('pr_size is optional, defaults its fields and takes no fail threshold', () => {
  expect(validateClutchConfig({ ...valid, pr_size: {} }).config?.pr_size).toEqual({
    warn: 300,
    exclude: [],
  });
  expect(paths({ ...valid, pr_size: { warn: 0, exclude: 'x', fail: 800 } })).toEqual([
    'pr_size.fail',
    'pr_size.warn',
    'pr_size.exclude',
  ]);
});

test('agentReview is optional and takes missingCredential notice or fail', () => {
  expect(validateClutchConfig(valid).config?.agentReview).toBeUndefined();
  expect(
    validateClutchConfig({ ...valid, agentReview: { missingCredential: 'fail' } }).config
      ?.agentReview,
  ).toEqual({ missingCredential: 'fail' });
  expect(paths({ ...valid, agentReview: { missingCredential: 'skip', model: 'x' } })).toEqual([
    'agentReview.model',
    'agentReview.missingCredential',
  ]);
  expect(paths({ ...valid, agentReview: 'fail' })).toEqual(['agentReview']);
});

test('fleet is optional and takes a list of repo and ref', () => {
  expect(validateClutchConfig(valid).config?.fleet).toBeUndefined();
  const fleet = [
    { repo: 'eggdev/clutch', ref: 'main' },
    { repo: 'blockmen-group/bar-savvy-web', ref: 'epic/refactor' },
  ];
  expect(validateClutchConfig({ ...valid, fleet }).config?.fleet).toEqual(fleet);
  expect(
    paths({ ...valid, fleet: [{ repo: 'nope', ref: 'has space', branch: 'x' }, 'shop'] }),
  ).toEqual(['fleet[0].branch', 'fleet[0].repo', 'fleet[0].ref', 'fleet[1]']);
  expect(paths({ ...valid, fleet: { repo: 'eggdev/clutch' } })).toEqual(['fleet']);
});

test('journeys is optional and takes the folder of the web app under apps/', () => {
  expect(validateClutchConfig(valid).config?.journeys).toBeUndefined();
  expect(
    validateClutchConfig({ ...valid, journeys: { webApp: 'apps/app' } }).config?.journeys,
  ).toEqual({ webApp: 'apps/app' });
  expect(paths({ ...valid, journeys: { webApp: 'features/app' } })).toEqual(['journeys.webApp']);
  expect(paths({ ...valid, journeys: { webApp: '../apps/app' } })).toEqual(['journeys.webApp']);
  expect(paths({ ...valid, journeys: { webApp: 'apps/app', browser: 'chrome' } })).toEqual([
    'journeys.browser',
  ]);
  expect(paths({ ...valid, journeys: 'apps/app' })).toEqual(['journeys']);
});

test('factory is optional and takes a root folder inside the project', () => {
  expect(validateClutchConfig(valid).config?.factory).toBeUndefined();
  expect(validateClutchConfig({ ...valid, factory: { root: '.' } }).config?.factory).toEqual({
    root: '.',
  });
  expect(paths({ ...valid, factory: { root: '../c-suite' } })).toEqual(['factory.root']);
  expect(paths({ ...valid, factory: { root: '/srv/tree' } })).toEqual(['factory.root']);
  expect(paths({ ...valid, factory: { root: 'factory', intake: [] } })).toEqual(['factory.intake']);
  expect(paths({ ...valid, factory: 'factory' })).toEqual(['factory']);
});
