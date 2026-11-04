import path from 'node:path';

import type { Agent } from '@/agent/prompt';
import { gitOrThrow } from '@/git';

/**
 * The command for the agent's harness. The prompt goes on stdin, so a long
 * issue or PR body never meets the argument size limit.
 *
 * - Claude runs in auto mode: a classifier checks each tool call, so the
 *   stage can edit, commit and run `bun run pr` without a person.
 * - Codex runs in the workspace-write sandbox with network access, so `gh`
 *   works. In a worktree, Git keeps its objects in the main checkout, so that
 *   folder is writable too.
 */
async function commandFor(agent: Agent, root: string) {
  if (agent.harness === 'claude') {
    return ['claude', '-p', '--model', agent.model, '--permission-mode', 'auto'];
  }
  if (agent.harness === 'codex') {
    const common = path.resolve(root, await gitOrThrow(root, 'rev-parse', '--git-common-dir'));
    return [
      'codex',
      'exec',
      '-m',
      agent.model,
      '--sandbox',
      'workspace-write',
      '-c',
      'sandbox_workspace_write.network_access=true',
      '--add-dir',
      common,
      '-',
    ];
  }
  throw new Error(
    `clutch agent run does not support the ${agent.harness} harness yet. Print the prompt with clutch agent prompt ${agent.name}, and run it by hand.`,
  );
}

/**
 * Runs one stage agent in the project at `root` with its harness and model,
 * and returns the exit code of the harness. The harness gets the terminal for
 * its output.
 */
export async function runAgent(options: {
  agent: Agent;
  prompt: string;
  root: string;
  env: Record<string, string | undefined>;
}) {
  const { agent, prompt, root, env } = options;
  const [name, ...args] = await commandFor(agent, root);
  const bin = Bun.which(name, { PATH: env.PATH ?? '' });
  if (!bin) {
    throw new Error(
      `${name} is not on PATH. The ${agent.name} agent runs on the ${agent.harness} harness.`,
    );
  }
  const proc = Bun.spawn([bin, ...args], {
    cwd: root,
    env,
    stdin: new Blob([prompt]),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return proc.exited;
}
