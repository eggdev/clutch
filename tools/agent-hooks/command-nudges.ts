import type { Outcome } from '@tools/agent-hooks/payload';

/**
 * Raw `gh` calls that a repeatable `bun run pr` command replaces, and that
 * command. See .agents/skills/deliver/references/commands.md.
 */
const nudges: Array<[RegExp, string]> = [
  [
    /^gh\s+pr\s+checks\b/u,
    '`mise exec -- bun run pr status <number>`, or `pr wait <number>` to wait',
  ],
  [/^gh\s+(?:pr|stack)\s+merge\b/u, '`mise exec -- bun run pr merge <number>`'],
  [/^gh\s+run\s+view\b.*\s--log/u, '`mise exec -- bun run pr failures <number>`'],
];

/** `mise exec --`, `command`, `time` and `NAME=value` before the program. */
const prefix = /^(?:mise\s+exec\s+--|command|time|\w+=\S*)\s+/u;

/**
 * The `bun run pr` command that replaces a raw `gh` call in `line`, or null.
 * Only a `gh` that starts a command counts, not one inside quoted text.
 */
function nudgeFor(line: string): string | null {
  for (const part of line.split(/&&|\|\||[;|\n]/u)) {
    let command = part.trim();
    for (let previous = ''; previous !== command;) {
      previous = command;
      command = command.replace(prefix, '');
    }
    const hit = nudges.find(([pattern]) => pattern.test(command));
    if (hit) {
      return hit[1];
    }
  }
  return null;
}

/**
 * A non-blocking hint for a raw `gh` call. It sets no permission decision, so
 * the call runs as usual. Claude Code reads `additionalContext` and shows
 * `systemMessage`. Both agents ignore what they do not know.
 */
export function commandNudge(line: string): Outcome | null {
  const command = nudgeFor(line);
  if (!command) {
    return null;
  }
  const hint = `Next time use ${command}. It is the repeatable command for this step. See .agents/skills/deliver/references/commands.md.`;
  return {
    exitCode: 0,
    stdout: `${JSON.stringify({
      systemMessage: hint,
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: hint },
    })}\n`,
  };
}
