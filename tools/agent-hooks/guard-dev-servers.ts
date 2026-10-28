import type { HookContext, Outcome, Payload } from '@tools/agent-hooks/payload';

/**
 * Commands that start a dev server or a simulator on their own. Each one
 * would start a second copy next to a server that already runs. The dev
 * command, `mise exec -- bun run dev`, uses a running server again. Each
 * pattern reads one command of a shell line, after its `VAR=value` prefixes
 * and its runner.
 */
const direct: ReadonlyArray<[label: string, pattern: RegExp]> = [
  ['a Vite dev server', /^vite(?:\s+(?:dev|serve|preview)\b|\s+--|\s*$)/u],
  ['bun --watch or bun --hot', /^bun\s+(?:run\s+)?--(?:watch|hot)\b/u],
  [
    'an Nx dev target',
    /^nx\s+(?:run\s+\S+:dev\b|run-many\b.*(?:-t|--targets?)[\s=]+\S*\bdev\b|dev\b|serve\b)/u,
  ],
  ['portless', /^portless(?!\s+(?:list|get|doctor|help|--help|-h)\b)/u],
  ['Expo', /^expo\s+(?:start|run(?::\S+)?)\b/u],
  ['an iOS simulator', /^(?:xcrun\s+simctl\s+boot|open\s+(?:-\S+\s+)*-a\s+Simulator)\b/u],
  ['an Android emulator', /^emulator\s+.*-avd\b/u],
];

/** The runners and prefixes that can stand before the command itself. */
const prefix =
  /^(?:(?:[A-Z_][A-Z0-9_]*=\S*\s+)+|mise\s+exec\s+--\s+|(?:bunx|npx|pnpx|pnpm\s+exec|pnpm\s+dlx|yarn|bun\s+x|bun\s+run(?!\s+--)|bun(?=\s+(?:nx|vite|portless|expo)\b))\s+)/u;

function stripPrefixes(command: string): string {
  let rest = command.trim();
  for (let previous = ''; previous !== rest;) {
    previous = rest;
    rest = rest.replace(prefix, '').trim();
  }
  return rest;
}

/** What a shell line starts, when it starts a dev server or a simulator itself. */
export function directStart(line: string): string | null {
  for (const part of line.split(/&&|\|\||[;|\n]/u)) {
    const command = stripPrefixes(part.replace(/^\s*\(+/u, ''));
    const hit = direct.find(([, pattern]) => pattern.test(command));
    if (hit) {
      return hit[0];
    }
  }
  return null;
}

/**
 * Before a shell command, refuse one that starts a dev server or a simulator
 * directly. Both Claude Code and Codex send the shell line in
 * `tool_input.command`, and both read a `deny` decision.
 */
export function guardDevServers(payload: Payload, _context: HookContext): Outcome {
  const line = payload.tool_input?.command;
  const what = typeof line === 'string' ? directStart(line) : null;
  if (!what) {
    return { exitCode: 0 };
  }
  const reason = `This command starts ${what} directly, next to any server that already runs. Run \`mise exec -- bun run dev\` instead. It uses running dev servers again and starts only the missing ones. \`mise exec -- bun run dev --check\` shows which run. See docs/contributing/setup/local-development.md.`;
  return {
    exitCode: 0,
    stdout: `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })}\n`,
  };
}
