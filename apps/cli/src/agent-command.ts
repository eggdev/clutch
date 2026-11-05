import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { markStage, stages } from '@/agent/mark';
import type { Stage } from '@/agent/mark';
import { buildPrompt, loadAgent, readIssueFile, readPull } from '@/agent/prompt';
import { runAgent } from '@/agent/run';
import { originRepo, runGh } from '@/doctor/remote';
import type { Gh } from '@/doctor/remote';
import { treeRoot } from '@/factory-command';
import { git } from '@/git';

export type AgentDeps = { gh?: Gh; env?: Record<string, string | undefined> };

const usageText = [
  'clutch agent prompt <name> [--issue CL-NNN] [--pr <number>]',
  'clutch agent run <name> [--issue CL-NNN] [--pr <number>]',
  'clutch agent mark <stage> [--pr <number>] [--issue CL-NNN] [--head SHA] [--note TEXT | --note-file PATH]',
].join('\n');

function parse(args: Array<string>) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      issue: { type: 'string' },
      pr: { type: 'string' },
      root: { type: 'string' },
      repo: { type: 'string' },
      head: { type: 'string' },
      note: { type: 'string' },
      'note-file': { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });
  if (values.pr !== undefined && (!/^\d+$/u.test(values.pr) || Number(values.pr) < 1)) {
    throw new Error('--pr takes the number of a pull request.');
  }
  if (values.issue !== undefined && !/^CL-\d{3}[a-z]?$/u.test(values.issue)) {
    throw new Error(`--issue takes an issue id such as CL-314, not ${values.issue}.`);
  }
  if (values.note !== undefined && values['note-file'] !== undefined) {
    throw new Error('Pass --note or --note-file, not both.');
  }
  if (values.head !== undefined && !/^[0-9a-f]{40}$/u.test(values.head)) {
    throw new Error('--head takes a full 40-character commit SHA.');
  }
  return { values, pr: values.pr === undefined ? undefined : Number(values.pr), positionals };
}

async function projectRoot(cwd: string) {
  const top = await git(cwd, 'rev-parse', '--show-toplevel');
  return top.ok ? top.out : cwd;
}

async function repoFor(cwd: string, flag: string | undefined) {
  const repo = flag ?? (await originRepo(cwd));
  if (!repo) {
    throw new Error('No GitHub origin remote. Pass --repo OWNER/NAME.');
  }
  return repo;
}

/** Loads the agent and builds its prompt from the issue file and the PR. */
async function preparePrompt(name: string, options: ReturnType<typeof parse>, cwd: string, gh: Gh) {
  const { values, pr } = options;
  const root = await treeRoot(cwd, values.root);
  const agent = await loadAgent(root.dir, name);
  const project = await projectRoot(cwd);
  const issue = values.issue ? await readIssueFile(project, values.issue) : undefined;
  const pull =
    pr === undefined ? undefined : await readPull(gh, await repoFor(cwd, values.repo), pr);
  return { agent, project, prompt: buildPrompt(agent, { issue, pull }) };
}

async function run(args: Array<string>, cwd: string, deps: AgentDeps) {
  const [sub, ...rest] = args;
  const gh = deps.gh ?? runGh;
  const options = parse(rest);
  const { values, pr, positionals } = options;
  const [name, ...extra] = positionals;
  if (!['prompt', 'run', 'mark'].includes(sub ?? '') || !name || extra.length > 0) {
    throw new Error(`Usage:\n${usageText}`);
  }
  if (sub === 'prompt') {
    const { prompt } = await preparePrompt(name, options, cwd, gh);
    process.stdout.write(prompt);
    return 0;
  }
  if (sub === 'run') {
    const { agent, project, prompt } = await preparePrompt(name, options, cwd, gh);
    console.error(`Running ${agent.name} (${agent.role}) on ${agent.harness} ${agent.model}.`);
    return runAgent({ agent, prompt, root: project, env: deps.env ?? process.env });
  }
  if (!stages.includes(name as Stage)) {
    throw new Error(`The stage is one of ${stages.join(', ')}, not ${name}.`);
  }
  const result = await markStage({
    gh,
    root: await projectRoot(cwd),
    role: name as Stage,
    repo: pr === undefined ? undefined : await repoFor(cwd, values.repo),
    pr,
    issue: values.issue,
    head: values.head,
    note: values['note-file'] ? await readFile(values['note-file'], 'utf-8') : values.note,
  });
  if (values.json) {
    console.log(JSON.stringify({ schemaVersion: 1, ...result }));
  } else if (result.status === 'saved') {
    console.log(
      `Saved the ${result.role} marker on ${result.head.slice(0, 7)}. The first mark with --pr and --issue ${values.issue} posts it.`,
    );
  } else {
    for (const comment of result.comments) {
      console.log(
        `${comment.edited ? 'Edited' : 'Posted'} ${comment.role} on ${comment.head.slice(0, 7)}: ${comment.url}`,
      );
    }
  }
  return 0;
}

/**
 * `clutch agent prompt|run|mark`: prints the prompt of a stage agent, runs it
 * with its harness and model, or records on the PR that a stage ran. It exits
 * with the harness's code for `run`, 0 for the others, and 1 on any failure.
 */
export async function agentCommand(
  args: Array<string>,
  cwd: string,
  deps: AgentDeps = {},
): Promise<number> {
  try {
    return await run(args, cwd, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.includes('--json')) {
      console.log(JSON.stringify({ schemaVersion: 1, status: 'error', message }));
    } else {
      console.error(message);
    }
    return 1;
  }
}
