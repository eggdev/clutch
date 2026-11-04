import { afterEach, expect, spyOn, test } from 'bun:test';
import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { agentCommand } from '@/agent-command';
import type { Gh } from '@/doctor/remote';
import { gitOrThrow } from '@/git';
import { fakeGitHub, head } from '@/testing/fake-github';
import { gitRepo } from '@/testing/git-repo';

const out = spyOn(console, 'log').mockImplementation(() => {});
const err = spyOn(console, 'error').mockImplementation(() => {});
const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
afterEach(() => {
  out.mockClear();
  err.mockClear();
  write.mockClear();
});
const printed = () => out.mock.calls.map((call) => String(call[0])).join('\n');
const errors = () => err.mock.calls.map((call) => String(call[0])).join('\n');
const stdout = () => write.mock.calls.map((call) => String(call[0])).join('');

const agent = (cli: string, model: string, body: string) =>
  `---\nrole: implement\ndescription: Builds one issue.\nharness: ${cli}\nmodel: ${model}\nrunner: spark\n---\n\n${body}\n`;

/** A project with a factory tree of 3 agents, one for each harness, and issue CL-428. */
function project() {
  return gitRepo({
    'factory/models.yaml': [
      'models:',
      '  - id: claude-opus-5-5',
      '    harness: claude',
      '  - id: gpt-6-luna',
      '    harness: codex',
      '  - id: qwen3.8-27b',
      '    harness: qwen',
      '    base_url: http://127.0.0.1:8092/v1',
      '',
    ].join('\n'),
    'factory/runners/spark.yaml': 'description: The Spark.\nmachine: spark\nworkspace: worktree\n',
    'factory/agents/implement/agent.md': agent(
      'claude',
      'claude-opus-5-5',
      '# Implement\n\nBuild it.',
    ),
    'factory/agents/review/agent.md': agent('codex', 'gpt-6-luna', '# Review\n\nJudge it.'),
    'factory/agents/local/agent.md': agent('qwen', 'qwen3.8-27b', '# Local\n\nTry it.'),
    'factory/agents/broken/agent.md': agent('codex', 'claude-opus-5-5', '# Broken'),
    '.clutch/issues/CL-428.md': '---\nid: CL-428\n---\n\n# CL-428: Make the checks fair\n',
  });
}

/** The fake GitHub, with the title, branches and body of PR 7. */
function github() {
  const fake = fakeGitHub();
  const gh: Gh = (args) => {
    if (args[1] === 'repos/o/r/pulls/7') {
      const pull = {
        title: 'feat(cli): fair checks (CL-428)',
        html_url: 'https://github.com/o/r/pull/7',
        body: '## Intent\n\nFair checks.',
        head: { sha: fake.state.head, ref: 'clutch/cl-428-fair-checks' },
        base: { ref: 'main' },
      };
      return Promise.resolve({ ok: true, out: JSON.stringify(pull), err: '' });
    }
    return fake.gh(args);
  };
  return { ...fake, gh };
}

/** A stand-in harness CLI that saves its arguments and its stdin next to itself. */
async function harness(dir: string, name: string) {
  const file = path.join(dir, name);
  await writeFile(
    file,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${file}.args"\n${Bun.which('cat')} > "${file}.stdin"\nexit 4\n`,
  );
  await chmod(file, 0o755);
  return {
    args: async () => {
      const text = await readFile(`${file}.args`, 'utf-8');
      return text.trim().split('\n');
    },
    stdin: () => readFile(`${file}.stdin`, 'utf-8'),
  };
}

test('clutch agent prompt prints the agent body, then the issue and the PR', async () => {
  await using repo = await project();
  const { gh } = github();
  const args = ['prompt', 'implement', '--issue', 'CL-428', '--pr', '7', '--repo', 'o/r'];
  expect(await agentCommand(args, repo.root, { gh })).toBe(0);
  expect(stdout()).toBe(
    [
      '# Implement',
      '',
      'Build it.',
      '',
      '## Your input',
      '',
      '### Issue `.clutch/issues/CL-428.md`',
      '',
      '---\nid: CL-428\n---\n\n# CL-428: Make the checks fair',
      '',
      '### Pull request #7',
      '',
      '- Title: feat(cli): fair checks (CL-428)',
      '- URL: https://github.com/o/r/pull/7',
      '- Branch: `clutch/cl-428-fair-checks` into `main`',
      `- Head: \`${head}\``,
      '',
      '## Intent\n\nFair checks.',
      '',
    ].join('\n'),
  );
});

test('clutch agent run passes the prompt on stdin to the harness with the agent model', async () => {
  await using repo = await project();
  const claude = await harness(repo.parent, 'claude');
  const codex = await harness(repo.parent, 'codex');
  const env = { PATH: repo.parent };

  const run = ['run', 'implement', '--issue', 'CL-428'];
  expect(await agentCommand(run, repo.root, { env })).toBe(4);
  expect(await claude.args()).toEqual([
    '-p',
    '--model',
    'claude-opus-5-5',
    '--permission-mode',
    'auto',
  ]);
  expect(await claude.stdin()).toStartWith('# Implement\n\nBuild it.\n\n## Your input\n');
  expect(await claude.stdin()).toContain('# CL-428: Make the checks fair');

  expect(await agentCommand(['run', 'review', '--issue', 'CL-428'], repo.root, { env })).toBe(4);
  const common = path.join(repo.root, '.git');
  expect(await codex.args()).toEqual([
    'exec',
    '-m',
    'gpt-6-luna',
    '--sandbox',
    'workspace-write',
    '-c',
    'sandbox_workspace_write.network_access=true',
    '--add-dir',
    common,
    '-',
  ]);
  const codexArgs = await codex.args();
  expect(codexArgs.join(' ')).not.toContain('dangerously');
  expect(await codex.stdin()).toStartWith('# Review\n\nJudge it.');
});

test('clutch agent run and prompt refuse an agent that the tree does not allow', async () => {
  await using repo = await project();
  const env = { PATH: repo.parent };
  expect(await agentCommand(['run', 'local', '--issue', 'CL-428'], repo.root, { env })).toBe(1);
  expect(await agentCommand(['prompt', 'broken'], repo.root, { env })).toBe(1);
  expect(await agentCommand(['prompt', 'nobody'], repo.root, { env })).toBe(1);
  expect(await agentCommand(['run', 'implement'], repo.root, { env })).toBe(1);
  expect(await agentCommand(['prompt', 'implement', '--issue', 'CL-999'], repo.root)).toBe(1);
  expect(errors().split('\n')).toEqual([
    'Running local (implement) on qwen qwen3.8-27b.',
    'clutch agent run does not support the qwen harness yet. Print the prompt with clutch agent prompt local, and run it by hand.',
    'agents/broken/agent.md: harness: models.yaml runs claude-opus-5-5 with claude, not codex.',
    'Run `clutch factory --check` after the fix.',
    `No agent nobody in ${path.join(repo.root, 'factory')}/agents. Agents: broken, implement, local, review.`,
    'Running implement (implement) on claude claude-opus-5-5.',
    'claude is not on PATH. The implement agent runs on the claude harness.',
    'No issue file .clutch/issues/CL-999.md.',
  ]);
});

test('clutch agent mark saves the early stages, then posts them before the stage with the PR', async () => {
  await using repo = await project();
  const fake = github();
  const { gh } = fake;
  const sha = await gitOrThrow(repo.root, 'rev-parse', 'HEAD');
  const saved = path.join(repo.root, '.git', 'clutch-stages', 'CL-428.json');

  const triage = ['mark', 'triage', '--issue', 'CL-428', '--note', 'Verdict: ready.'];
  expect(await agentCommand(triage, repo.root, { gh })).toBe(0);
  const early = ['mark', 'spec', '--issue', 'CL-428', '--head', 'c'.repeat(40), '--note', 'Old.'];
  expect(await agentCommand(early, repo.root, { gh })).toBe(0);
  expect(await agentCommand(['mark', 'spec', '--issue', 'CL-428'], repo.root, { gh })).toBe(0);
  expect(printed()).toContain(`Saved the triage marker on ${sha.slice(0, 7)}.`);
  expect(fake.state.comments).toEqual([]);

  const implement = ['mark', 'implement', '--pr', '7', '--issue', 'CL-428', '--repo', 'o/r'];
  expect(await agentCommand(implement, repo.root, { gh })).toBe(0);
  expect(fake.state.comments.map((comment) => comment.body)).toEqual([
    `<!-- clutch-stage:triage:${sha} -->\nStage \`triage\` ran on \`${sha.slice(0, 7)}\` before the PR opened.\n\nVerdict: ready.`,
    `<!-- clutch-stage:spec:${sha} -->\nStage \`spec\` ran on \`${sha.slice(0, 7)}\` before the PR opened.`,
    `<!-- clutch-stage:implement:${head} -->\nStage \`implement\` ran on \`aaaaaaa\`.`,
  ]);
  expect(stat(saved)).rejects.toThrow();

  const note = path.join(repo.parent, 'review.md');
  await writeFile(note, 'Verdict: pass\n\nNo findings.\n');
  const review = ['mark', 'review', '--pr', '7', '--repo', 'o/r', '--note-file', note, '--json'];
  out.mockClear();
  expect(await agentCommand(review, repo.root, { gh })).toBe(0);
  expect(await agentCommand(review, repo.root, { gh })).toBe(0);
  expect(fake.state.comments).toHaveLength(4);
  expect(fake.state.comments[3].body).toBe(
    `<!-- clutch-stage:review:${head} -->\nStage \`review\` ran on \`aaaaaaa\`.\n\nVerdict: pass\n\nNo findings.`,
  );
  const [first, second] = out.mock.calls.map((call) => JSON.parse(String(call[0])));
  expect(first.comments).toEqual([{ role: 'review', head, url: 'https://c/4', edited: false }]);
  expect(second.comments[0].edited).toBe(true);

  const other = 'b'.repeat(40);
  const again = ['mark', 'review', '--pr', '7', '--repo', 'o/r', '--head', other];
  expect(await agentCommand(again, repo.root, { gh })).toBe(0);
  expect(fake.state.comments).toHaveLength(5);
});

test('a bad argument exits 1 with the reason', async () => {
  await using repo = await project();
  const { gh } = github();
  const cases = [
    ['show', 'implement'],
    ['prompt'],
    ['mark', 'deploy', '--pr', '7'],
    ['mark', 'review'],
    ['mark', 'review', '--pr', 'x'],
    ['mark', 'review', '--issue', 'CL-1'],
    ['mark', 'review', '--pr', '7', '--head', 'abc'],
    ['mark', 'review', '--pr', '7', '--note', 'a', '--note-file', 'b'],
    ['mark', 'review', '--pr', '7'],
  ];
  for (const args of cases) {
    expect(await agentCommand(args, repo.root, { gh })).toBe(1);
  }
  const lines = errors().split('\n');
  expect(lines[0]).toBe('Usage:');
  expect(lines.slice(-7)).toEqual([
    'The stage is one of triage, spec, implement, review, verify, not deploy.',
    'Pass --pr, or --issue for a stage that runs before the PR exists.',
    '--pr takes the number of a pull request.',
    '--issue takes an issue id such as CL-314, not CL-1.',
    '--head takes a full 40-character commit SHA.',
    'Pass --note or --note-file, not both.',
    'No GitHub origin remote. Pass --repo OWNER/NAME.',
  ]);
  expect(await agentCommand(['mark', 'review', '--json'], repo.root, { gh })).toBe(1);
  expect(JSON.parse(printed())).toMatchObject({ status: 'error' });
});
