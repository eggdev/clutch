import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { editedFiles } from '@tools/agent-hooks/payload';
import type { HookContext, Outcome, Payload } from '@tools/agent-hooks/payload';

/** The list of guardrail files. It is a guardrail file too. */
export const guardrailList = 'tools/guardrail-files.json';

export function guardrailPatterns(root: string): Array<string> {
  const list = JSON.parse(readFileSync(path.join(root, guardrailList), 'utf-8'));
  return list.patterns;
}

/**
 * Before an edit to a guardrail file, a person decides. Claude Code shows the
 * user a permission prompt. Codex cannot ask from a hook, so the hook refuses
 * the edit and tells the agent to ask the user. While KICKOFF.md exists,
 * kickoff writes these files, so the hook lets every edit through.
 */
export function guardGuardrails(payload: Payload, { agent, root }: HookContext): Outcome {
  if (existsSync(path.join(root, 'KICKOFF.md'))) {
    return { exitCode: 0 };
  }
  const patterns = guardrailPatterns(root).map((pattern) => new Bun.Glob(pattern));
  const hits = editedFiles(payload, root).filter((file) =>
    patterns.some((pattern) => pattern.match(file)),
  );
  if (!hits.length) {
    return { exitCode: 0 };
  }
  const files = hits.map((file) => `\`${file}\``).join(', ');
  const what = `${files} configures a check, a lint rule, a budget or an agent hook.`;
  const decision =
    agent === 'claude'
      ? {
          permissionDecision: 'ask',
          permissionDecisionReason: `${what} Approve this edit only if you want that rule to change.`,
        }
      : {
          permissionDecision: 'deny',
          permissionDecisionReason: `${what} A person approves each change to it. Stop. Tell the user which rule you want to change and why, and wait for their answer.`,
        };
  return {
    exitCode: 0,
    stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...decision } })}\n`,
  };
}
