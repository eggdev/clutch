import { expect, test } from 'bun:test';
import path from 'node:path';

import { checkFactoryTree } from '@/factory/check';
import { gitRepo } from '@/testing/git-repo';

const fixtures = path.join(import.meta.dir, 'fixtures');
async function problemsOf(root: string) {
  const { problems } = await checkFactoryTree(root);
  return problems;
}

async function keys(root: string) {
  const problems = await problemsOf(root);
  return problems.map((problem) => `${problem.file} ${problem.key}`);
}

const qwenUrl = '    base_url: http://localhost:11434/v1\n';
const models = `models:\n  - id: opus\n    harness: claude\n  - id: qwen\n    harness: qwen\n${qwenUrl}`;
const runner = 'description: A box.\nmachine: box\nt3_environment: local\nworkspace: worktree\n';
const agent = (role: string, extra = '') =>
  `---\nrole: ${role}\ndescription: An agent.\nharness: claude\nmodel: opus\nrunner: box\n${extra}---\n\nDo the work.\n`;
const base = {
  'models.yaml': models,
  'runners/box.yaml': runner,
  'agents/implement/agent.md': agent('implement'),
};
const scorer = (labels: string, pass = 1) =>
  `---\nagents: [implement]\njudge: qwen\nlabels:\n${labels}passingScore: ${pass}\nsamplingRate: 25\n---\n\nJudge it.\n`;
const label = (value: string, score: number) =>
  `  - value: ${value}\n    score: ${score}\n    description: A grade.\n`;

const tree = (files: Record<string, string>) => gitRepo(files, { git: false });
const automation = (trigger: string) =>
  `---\nagent: implement\ntrigger:\n${trigger}---\n\nStart.\n`;

test('the good tree passes and counts each kind', async () => {
  expect(await checkFactoryTree(path.join(fixtures, 'good'))).toEqual({
    counts: { agents: 3, automations: 1, runners: 1, scorers: 1, benchmarks: 1, models: 1 },
    problems: [],
  });
});

test('each bad fixture names its file and its key', async () => {
  const cases: Record<string, Array<string>> = {
    'unknown-key': ['runners/spark.yaml gpu'],
    'missing-runner': ['agents/implement/agent.md runner'],
    'missing-agent': ['automations/nightly-triage/automation.md agent'],
    'bad-enum': ['agents/implement/agent.md role'],
    'empty-prompt': ['agents/implement/agent.md body'],
    'bad-schedule': [
      'automations/nightly-triage/automation.md trigger.time',
      'automations/nightly-triage/automation.md trigger.weekdays[0]',
    ],
  };
  for (const [name, expected] of Object.entries(cases)) {
    expect({ name, problems: await keys(path.join(fixtures, name)) }).toEqual({
      name,
      problems: expected,
    });
  }
  const [missing] = await problemsOf(path.join(fixtures, 'missing-runner'));
  expect(missing.reason).toBe('No file runners/gpu-box.yaml.');
});

test('an empty folder has no files and no problems', async () => {
  await using dir = await tree({ 'README.md': '# Tree\n' });
  const result = await checkFactoryTree(dir.root);
  expect(result.problems).toEqual([]);
  expect(Object.values(result.counts).every((count) => count === 0)).toBe(true);
});

test('a tree has at most 1 foreman', async () => {
  await using one = await tree({ ...base, 'agents/lead/agent.md': agent('foreman') });
  expect(await keys(one.root)).toEqual([]);
  await using two = await tree({
    ...base,
    'agents/lead/agent.md': agent('foreman'),
    'agents/second/agent.md': agent('foreman'),
  });
  expect(await keys(two.root)).toEqual(['agents/second/agent.md role']);
});

test('a model must be in models.yaml, with the same harness as the agent', async () => {
  await using missing = await tree({
    ...base,
    'agents/implement/agent.md': agent('implement').replace('model: opus', 'model: sonnet'),
  });
  expect(await keys(missing.root)).toEqual(['agents/implement/agent.md model']);
  await using mismatch = await tree({
    ...base,
    'agents/implement/agent.md': agent('implement').replace('model: opus', 'model: qwen'),
  });
  expect(await keys(mismatch.root)).toEqual(['agents/implement/agent.md harness']);
  await using bare = await tree({
    'runners/box.yaml': runner,
    'agents/implement/agent.md': agent('implement'),
  });
  const [problem] = await problemsOf(bare.root);
  expect(problem).toEqual({
    file: 'agents/implement/agent.md',
    key: 'model',
    reason: '"opus" needs models.yaml, and the tree has none.',
  });
  await using twice = await tree({
    ...base,
    'models.yaml': `${models}  - id: opus\n    harness: claude\n`,
  });
  expect(await keys(twice.root)).toEqual(['models.yaml models[2].id']);
});

test('a scorer needs known agents, a known judge, and labels that pass and fail', async () => {
  await using good = await tree({
    ...base,
    'scorers/fit/scorer.md': scorer(label('pass', 1) + label('fail', 0)),
  });
  expect(await keys(good.root)).toEqual([]);
  await using person = await tree({
    ...base,
    'scorers/fit/scorer.md': scorer(label('pass', 1) + label('fail', 0)).replace(
      'judge: qwen',
      'judge: brendan',
    ),
  });
  expect(await keys(person.root)).toEqual([]);
  await using bad = await tree({
    ...base,
    'scorers/fit/scorer.md': scorer(label('pass', 1) + label('pass', 1))
      .replace('[implement]', '[implement, ghost]')
      .replace('judge: qwen', 'judge: qwen3.9'),
  });
  expect(await keys(bad.root)).toEqual([
    'scorers/fit/scorer.md agents[1]',
    'scorers/fit/scorer.md judge',
    'scorers/fit/scorer.md labels[1].value',
    'scorers/fit/scorer.md labels',
  ]);
  await using none = await tree({
    ...base,
    'scorers/fit/scorer.md': scorer(label('low', 0.2), 0.5).replace(
      'samplingRate: 25',
      'samplingRate: 25.5',
    ),
  });
  expect(await keys(none.root)).toEqual([
    'scorers/fit/scorer.md samplingRate',
    'scorers/fit/scorer.md labels',
  ]);
});

const sha = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const benchmark = (configs: string, tasks: string) =>
  `---\ndescription: Compares models.\nagent: implement\nconfigs:\n${configs}tasks:\n${tasks}---\n\nWhat it measures.\n`;
const config = (configName: string, model: string) =>
  `  - name: ${configName}\n    model: ${model}\n`;
const task = (taskName: string, commit = sha) =>
  `  - name: ${taskName}\n    commit: ${commit}\n    issue: .clutch/issues/CL-001.md\n    check: bun test\n`;

test('a benchmark needs a known agent, known models and unique names', async () => {
  await using good = await tree({
    ...base,
    'benchmarks/compare/benchmark.md': benchmark(
      config('opus', 'opus') + config('qwen', 'qwen'),
      task('one'),
    ),
  });
  expect(await keys(good.root)).toEqual([]);
  await using bad = await tree({
    ...base,
    'benchmarks/compare/benchmark.md': benchmark(
      config('opus', 'opus') + config('opus', 'opus') + config('gpt', 'gpt-9'),
      task('one') + task('one', 'abc1234'),
    ).replace('agent: implement', 'agent: ghost'),
  });
  expect(await keys(bad.root)).toEqual([
    'benchmarks/compare/benchmark.md tasks[1].commit',
    'benchmarks/compare/benchmark.md agent',
    'benchmarks/compare/benchmark.md configs[2].model',
    'benchmarks/compare/benchmark.md configs[1].name',
    'benchmarks/compare/benchmark.md configs[1].model',
    'benchmarks/compare/benchmark.md tasks[1].name',
  ]);
  await using one = await tree({
    ...base,
    'benchmarks/compare/benchmark.md': benchmark(config('opus', 'opus'), task('one')),
  });
  expect(await keys(one.root)).toEqual(['benchmarks/compare/benchmark.md configs']);
});

test('a scorer whose judge runs with qwen needs the base_url of its model', async () => {
  const files = { ...base, 'scorers/fit/scorer.md': scorer(label('pass', 1) + label('fail', 0)) };
  await using missing = await tree({
    ...files,
    'models.yaml': models.replace(qwenUrl, ''),
  });
  expect(await problemsOf(missing.root)).toEqual([
    {
      file: 'scorers/fit/scorer.md',
      key: 'judge',
      reason: '"qwen" runs with qwen, so its item in models.yaml needs a base_url.',
    },
  ]);
  await using bad = await tree({
    ...files,
    'models.yaml': models.replace('http://localhost:11434/v1', 'localhost:11434'),
  });
  expect(await keys(bad.root)).toEqual(['models.yaml models[1].base_url']);
  await using claude = await tree({
    ...files,
    'models.yaml': `${models}  - id: sonnet\n    harness: claude\n`,
    'scorers/fit/scorer.md': files['scorers/fit/scorer.md'].replace('judge: qwen', 'judge: sonnet'),
  });
  expect(await keys(claude.root)).toEqual([]);
});

test('each trigger type takes its own keys', async () => {
  await using good = await tree({
    ...base,
    'automations/intake/automation.md': automation(
      '  type: github\n  event: issue_labeled\n  label: factory\n',
    ),
    'automations/linear/automation.md': automation('  type: linear\n  label: Agent\n'),
    'automations/hook/automation.md': automation('  type: webhook\n'),
  });
  expect(await keys(good.root)).toEqual([]);
  await using bad = await tree({
    ...base,
    'automations/intake/automation.md': automation('  type: github\n  time: "07:00"\n'),
    'automations/mail/automation.md': automation('  type: email\n'),
  });
  expect(await keys(bad.root)).toEqual([
    'automations/intake/automation.md trigger.event',
    'automations/intake/automation.md trigger.time',
    'automations/mail/automation.md trigger.type',
  ]);
});

test('files in the wrong place, or that do not parse, are problems', async () => {
  await using dir = await tree({
    ...base,
    'agents/notes.md': '# Notes\n',
    'agents/README.md': '# Agents\n',
    'agents/empty/.gitkeep': '',
    'agents/Big_Name/agent.md': agent('custom'),
    'agents/plain/agent.md': 'No frontmatter.\n',
    'agents/broken/agent.md': '---\nrole: [custom\n---\n\nText.\n',
    'agents/blank/agent.md':
      '---\nrole: custom\ndescription: An agent.\nharness: claude\nmodel: opus\nrunner:\n---\n\nText.\n',
    'runners/old.yml': runner,
    'runners/nested/box.yaml': runner,
    'benchmarks/compare/notes.md': '# Notes\n',
  });
  expect(await keys(dir.root)).toEqual([
    'agents/Big_Name ',
    'agents/blank/agent.md runner',
    'agents/broken/agent.md ',
    'agents/empty ',
    'agents/notes.md ',
    'agents/plain/agent.md ',
    'benchmarks/compare ',
    'runners/nested ',
    'runners/old.yml ',
  ]);
});
