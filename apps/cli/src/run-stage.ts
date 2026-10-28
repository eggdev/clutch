import { appendFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import type { Stage } from '@/next-step';
import type { Provider } from '@/providers';

type RunnableStage = Exclude<Stage, 'done'>;

/**
 * The tools that an unattended Claude stage may use. Writes stay in the
 * project, and each shell command is named, so the agent cannot push, deploy
 * or change state outside the repository.
 */
const surveyTools = [
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
  'Bash(mise exec -- bun tools/check-:*)',
];

/** The migration also deletes and moves files, formats, applies lint fixes and runs single checks. */
const migrateTools = [
  ...surveyTools,
  'Bash(git rm:*)',
  'Bash(git mv:*)',
  'Bash(mise exec -- bun run format:*)',
  'Bash(mise exec -- bun x oxlint --fix:*)',
  'Bash(mise exec -- bun test:*)',
  'Bash(mise exec -- bun nx run-many -t typecheck:*)',
  'Bash(mise exec -- bun nx run-many -t lint:*)',
  'Bash(mise exec -- bun nx run-many -t test:*)',
  'Bash(mise exec -- bun nx run-many -t format-check:*)',
  'Bash(mise exec -- bun nx run-many -t checks:*)',
];

/** The arguments for each provider and stage. The interview is interactive. The other stages run unattended. */
function commandFor(provider: Provider, stage: RunnableStage) {
  const interactive = stage === 'interview';
  if (provider.id === 'claude') {
    return interactive
      ? ['/kickoff interview']
      : [
          '-p',
          `/kickoff ${stage}`,
          '--permission-mode',
          'dontAsk',
          '--allowedTools',
          ...(stage === 'migrate' ? migrateTools : surveyTools),
          '--output-format',
          'stream-json',
          '--verbose',
        ];
  }
  if (provider.id === 'codex') {
    return interactive
      ? ['$kickoff interview']
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
 * Adds `core.hooksPath=/dev/null` to the Git config of the agent's commands.
 * The template's hooks run the gate, and the gate passes only after the
 * migration, so each commit before that would fail. The migration ends with a
 * full `validate`.
 */
function withoutGitHooks(env: Record<string, string | undefined>) {
  const count = Number(env.GIT_CONFIG_COUNT ?? 0);
  return {
    ...env,
    GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: 'core.hooksPath',
    [`GIT_CONFIG_VALUE_${count}`]: '/dev/null',
  };
}

/**
 * Runs one kickoff stage with the provider's CLI in the project. The
 * interview gets the terminal. An unattended stage writes each event line to
 * a log in the project's git folder, where no commit picks it up, and passes
 * the line to `onEvent`. Returns the agent's exit code.
 */
export async function runStage(options: {
  provider: Provider;
  stage: RunnableStage;
  root: string;
  env: Record<string, string | undefined>;
  onEvent?: (line: string) => void;
}) {
  const { provider, stage, root } = options;
  const env = withoutGitHooks(options.env);
  const bin = Bun.which(provider.bin, { PATH: env.PATH ?? '' });
  if (!bin) {
    throw new Error(`${provider.bin} is not on PATH`);
  }
  const cmd = [bin, ...commandFor(provider, stage)];
  if (stage === 'interview') {
    const proc = Bun.spawn(cmd, { cwd: root, env, stdio: ['inherit', 'inherit', 'inherit'] });
    return proc.exited;
  }

  const gitDir = path.resolve(root, await gitOrThrow(root, 'rev-parse', '--git-dir'));
  const log = path.join(gitDir, `template-install-${stage}.log`);
  const proc = Bun.spawn(cmd, {
    cwd: root,
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
