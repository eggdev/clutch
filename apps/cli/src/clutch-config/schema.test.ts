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

test('worktree is optional, and copy and setup default to empty lists', () => {
  const { worktree: _, ...noWorktree } = valid;
  expect(validateClutchConfig(noWorktree).config?.worktree).toBeUndefined();
  expect(validateClutchConfig({ ...valid, worktree: { root: '../w' } }).config?.worktree).toEqual({
    root: '../w',
    copy: [],
    setup: [],
  });
});

const paths = (data: unknown) => validateClutchConfig(data).errors.map((error) => error.path);

test('each top-level and template problem names its YAML path', () => {
  expect(
    paths({
      ...valid,
      schemaVersion: 2,
      project: '',
      fleet: [],
      template: { repo: 'clutch', commit: 'abc123', mode: 'copy', branch: 'main' },
    }),
  ).toEqual([
    'fleet',
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
  expect(paths({ ...valid, worktree: { copy: '.env', setup: [1], extra: true } })).toEqual([
    'worktree.extra',
    'worktree.root',
    'worktree.copy',
    'worktree.setup',
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
