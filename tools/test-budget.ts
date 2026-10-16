/**
 * Runs a test command and fails when it takes longer than its budget. A slow
 * suite slows every push. It is often the first sign of a test that reaches the
 * network or builds too much setup.
 *
 * Usage: bun tools/test-budget.ts <seconds> -- <command...>
 */
export function budgetError(elapsedMs: number, budgetSeconds: number): string | null {
  const elapsed = elapsedMs / 1000;
  if (elapsed <= budgetSeconds) {
    return null;
  }
  return [
    `The tests took ${elapsed.toFixed(1)}s. The budget is ${budgetSeconds}s.`,
    'bun test prints the time of each test. Make the slowest ones faster: no network, less setup.',
    'Never delete or skip a test to fit the budget. Raise the budget only in a reviewed change that says why.',
  ].join('\n');
}

export function parseArgs(args: Array<string>): { budgetSeconds: number; command: Array<string> } {
  const [seconds, separator, ...command] = args;
  const budgetSeconds = Number(seconds);
  if (
    !Number.isFinite(budgetSeconds) ||
    budgetSeconds <= 0 ||
    separator !== '--' ||
    command.length === 0
  ) {
    throw new Error('Usage: bun tools/test-budget.ts <seconds> -- <command...>');
  }
  return { budgetSeconds, command };
}

if (import.meta.main) {
  const { budgetSeconds, command } = parseArgs(Bun.argv.slice(2));
  const start = performance.now();
  const run = Bun.spawnSync(command, { stdout: 'inherit', stderr: 'inherit' });
  if (run.exitCode !== 0) {
    process.exit(run.exitCode ?? 1);
  }
  const error = budgetError(performance.now() - start, budgetSeconds);
  if (error) {
    console.error(error);
    process.exit(1);
  }
}
