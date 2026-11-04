/**
 * How a run starts each harness's CLI. The agent runs on the signed-in plan of
 * the CLI. The run removes each API key from the environment, so it never
 * bills per token.
 */

/** Each run of an agent stops at this time or this number of turns. */
export const limits = { minutes: 20, turns: 80, checkMinutes: 10 };

/** The tools that a `claude` run may use without a prompt. The rest are denied. */
const allowed = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'TodoWrite',
  'Bash(mise exec:*)',
  'Bash(bun:*)',
  'Bash(bunx:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(head:*)',
  'Bash(tail:*)',
  'Bash(wc:*)',
  'Bash(rg:*)',
  'Bash(grep:*)',
  'Bash(find:*)',
  'Bash(mkdir:*)',
];
const denied = ['Bash(git push:*)', 'Bash(gh:*)', 'Bash(bun run pr:*)', 'WebFetch', 'WebSearch'];

/** The command that runs `model` with `harness`. It reads the prompt on stdin. */
export function agentCommand(harness: string, model: string) {
  if (harness !== 'claude') {
    throw new Error(
      `clutch bench runs only claude models today. ${model} uses ${harness}. See apps/cli/README.md#bench.`,
    );
  }
  return [
    'claude',
    '--print',
    '--model',
    model,
    '--max-turns',
    String(limits.turns),
    '--output-format',
    'json',
    '--no-session-persistence',
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    allowed.join(','),
    '--disallowedTools',
    denied.join(','),
  ];
}

/** Why the agent stopped. */
export type Exit = 'done' | 'turns' | 'timeout' | 'error' | 'setup';

/** Reads why a `claude --output-format json` run stopped, and its turn count. */
export function readAgentOutput(code: number, timedOut: boolean, stdout: string) {
  let summary: { subtype?: unknown; num_turns?: unknown; is_error?: unknown } = {};
  try {
    summary = JSON.parse(stdout.trim().split('\n').at(-1) ?? '');
  } catch {
    // A run that stops early prints no summary.
  }
  const turns = typeof summary.num_turns === 'number' ? summary.num_turns : undefined;
  let exit: Exit = 'done';
  if (timedOut) {
    exit = 'timeout';
  } else if (summary.subtype === 'error_max_turns') {
    exit = 'turns';
  } else if (code !== 0 || summary.is_error === true) {
    exit = 'error';
  }
  return { exit, turns };
}

/**
 * The environment of an agent. It has no API key, so the CLI uses its plan.
 * It has no setting of an agent session that starts the run, such as
 * `CLAUDE_EFFORT`, so each config runs with the same defaults.
 */
export function agentEnv(env: NodeJS.ProcessEnv) {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const session = (key.startsWith('CLAUDE') && key !== 'CLAUDE_CONFIG_DIR') || key === 'AI_AGENT';
    const apiKey = key === 'ANTHROPIC_API_KEY' || key === 'ANTHROPIC_AUTH_TOKEN';
    if (value !== undefined && !session && !apiKey) {
      clean[key] = value;
    }
  }
  return clean;
}
