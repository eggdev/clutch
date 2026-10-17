import { appendFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@apps/cli/src/git';
import type { Stage } from '@apps/cli/src/next-step';
import type { Provider } from '@apps/cli/src/providers';

type RunnableStage = Exclude<Stage, 'done'>;

/**
 * The tools that an unattended Claude stage may use. Writes stay in the
 * worktree, and each shell command is named, so the agent cannot push, deploy
 * or change state outside the repository.
 */
const claudeTools = [
  'Read',
  'Glob',
  'Grep',
  'Edit',
  'Write',
  'WebFetch',
  'WebSearch',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git diff:*)',
  'Bash(git status:*)',
  'Bash(git ls-files:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(mise exec -- bun install:*)',
  'Bash(mise exec -- bun run validate:*)',
  'Bash(mise exec -- bun tools/check-kickoff-slots.ts:*)',
  'Bash(mise exec -- bun tools/check-primitives.ts:*)',
];

/** The arguments for each provider and stage. The interview is interactive. The other stages run unattended. */
function commandFor(provider: Provider, stage: RunnableStage) {
  const interactive = stage === 'interview';
  if (provider.id === 'claude') {
    return interactive
      ? ['/kickoff']
      : [
          '-p',
          `/kickoff ${stage}`,
          '--permission-mode',
          'dontAsk',
          '--allowedTools',
          ...claudeTools,
          '--output-format',
          'stream-json',
          '--verbose',
        ];
  }
  if (provider.id === 'codex') {
    return interactive
      ? ['$kickoff']
      : [
          'exec',
          '--sandbox',
          'workspace-write',
          '-c',
          'sandbox_workspace_write.network_access=true',
          '--json',
          `$kickoff ${stage}`,
        ];
  }
  throw new Error(`No commands for the provider ${provider.id}`);
}

/**
 * Runs one kickoff stage with the provider's CLI in the worktree. The
 * interview gets the terminal. An unattended stage writes each event line to
 * a log in the worktree's git folder, where no commit picks it up, and passes
 * the line to `onEvent`. Returns the agent's exit code.
 */
export async function runStage(options: {
  provider: Provider;
  stage: RunnableStage;
  worktree: string;
  env: Record<string, string | undefined>;
  onEvent?: (line: string) => void;
}) {
  const { provider, stage, worktree, env } = options;
  const bin = Bun.which(provider.bin, { PATH: env.PATH ?? '' });
  if (!bin) {
    throw new Error(`${provider.bin} is not on PATH`);
  }
  const cmd = [bin, ...commandFor(provider, stage)];
  if (stage === 'interview') {
    const proc = Bun.spawn(cmd, { cwd: worktree, env, stdio: ['inherit', 'inherit', 'inherit'] });
    return proc.exited;
  }

  const gitDir = path.resolve(worktree, await gitOrThrow(worktree, 'rev-parse', '--git-dir'));
  const log = path.join(gitDir, `template-install-${stage}.log`);
  const proc = Bun.spawn(cmd, {
    cwd: worktree,
    env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of proc.stdout) {
    const text = decoder.decode(chunk, { stream: true });
    await appendFile(log, text);
    const lines = (pending + text).split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines.filter(Boolean)) {
      options.onEvent?.(line);
    }
  }
  await appendFile(log, await new Response(proc.stderr).text());
  return proc.exited;
}
