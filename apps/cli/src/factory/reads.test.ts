import { expect, test } from 'bun:test';

import { checkFactoryTree } from '@/factory/check';
import { linkTargets } from '@/factory/reads';
import { gitRepo } from '@/testing/git-repo';

const models = 'models:\n  - id: opus\n    harness: claude\n';
const runner = 'description: A box.\nmachine: box\nt3_environment: local\nworkspace: worktree\n';
const agent = (reads: string, body: string) =>
  `---\nrole: implement\ndescription: An agent.\nharness: claude\nmodel: opus\nrunner: box\nreads:\n${reads}---\n\n${body}\n`;

/** A project with docs at its root and the tree at `factory/`. */
const project = (agentFile: string) =>
  gitRepo(
    {
      'AGENTS.md': '# Agents\n',
      'docs/contributing/testing.md': '# Testing\n',
      'docs/principles/index.md': '# Principles\n',
      'factory/models.yaml': models,
      'factory/runners/box.yaml': runner,
      'factory/agents/implement/agent.md': agentFile,
    },
    { git: false },
  );

async function problems(agentFile: string) {
  await using dir = await project(agentFile);
  const result = await checkFactoryTree(`${dir.root}/factory`, dir.root);
  return result.problems;
}

test('a reads path that exists and that the prompt links passes', async () => {
  const body = [
    'Read [`AGENTS.md`](../../../AGENTS.md) and [testing](/docs/contributing/testing.md#run).',
    'Then read [the principles][p].',
    '',
    '[p]: ../../../docs/principles/',
  ].join('\n');
  const reads = '  - AGENTS.md\n  - docs/contributing/testing.md\n  - docs/principles\n';
  expect(await problems(agent(reads, body))).toEqual([]);
});

test('a missing reads path fails, and names the agent file and the path', async () => {
  const body = 'Read [`docs/missing.md`](../../../docs/missing.md).';
  expect(await problems(agent('  - docs/missing.md\n', body))).toEqual([
    {
      file: 'agents/implement/agent.md',
      key: 'reads[0]',
      reason: '"docs/missing.md" does not exist at the project root.',
    },
  ]);
});

test('a reads path with no link in the prompt fails', async () => {
  const body = 'Read `AGENTS.md`.\n\n```md\n[AGENTS.md](../../../AGENTS.md)\n```';
  expect(await problems(agent('  - AGENTS.md\n', body))).toEqual([
    {
      file: 'agents/implement/agent.md',
      key: 'reads[0]',
      reason:
        'The prompt has no Markdown link to "AGENTS.md". Add one, such as [`AGENTS.md`](../../../AGENTS.md).',
    },
  ]);
});

test('a link that resolves from the tree root, not the agent folder, fails', async () => {
  const body = 'Read [AGENTS.md](AGENTS.md).';
  const [problem] = await problems(agent('  - AGENTS.md\n', body));
  expect(problem?.key).toBe('reads[0]');
});

async function keys(reads: string) {
  const found = await problems(agent(reads, 'Read it.'));
  return found.map((problem) => problem.key);
}

test('a reads path must start at the project root and stay in it', async () => {
  expect(await keys('  - /AGENTS.md\n')).toEqual(['reads[0]']);
  expect(await keys('  - ../AGENTS.md\n')).toEqual(['reads[0]']);
  expect(await keys('  - docs/../AGENTS.md\n')).toEqual(['reads[0]']);
  expect(await keys('  - ./AGENTS.md\n')).toEqual(['reads[0]']);
  expect(await keys('  - AGENTS.md\n  - AGENTS.md\n')).toEqual(['reads']);
  expect(await keys(' []\n')).toEqual(['reads']);
});

test('linkTargets reads inline and reference links, and skips fenced code', () => {
  const body = ['[a](a.md) and ![b](<b.png> "B")', '~~~', '[c](c.md)', '~~~', '  [d]: d.md'].join(
    '\n',
  );
  expect(linkTargets(body)).toEqual(['a.md', 'b.png', 'd.md']);
});
