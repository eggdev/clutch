import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * Shared input and output for the agent hooks in `.agents/hooks/`. Claude Code
 * and Codex send one JSON object on stdin with the same core fields. A hook
 * answers with an exit code and optional stdout and stderr. Each entry script
 * passes its agent name, `claude` or `codex`, as the first argument. See
 * docs/contributing/harness-engineering.md#agent-hooks.
 */
type Agent = 'claude' | 'codex';

export type Payload = {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  stop_hook_active?: boolean;
};

export type Outcome = { exitCode: number; stdout?: string; stderr?: string };

export type HookContext = { agent: Agent; root: string };

export type Hook = (payload: Payload, context: HookContext) => Outcome | Promise<Outcome>;

/** A command's exit code and its combined output. */
export type Run = (
  command: Array<string>,
  root: string,
  env?: Record<string, string>,
) => { exitCode: number; output: string };

export const run: Run = (command, root, env = {}) => {
  const result = Bun.spawnSync(command, {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env },
  });
  return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` };
};

function agentOf(value: string | undefined): Agent {
  if (value === 'claude' || value === 'codex') {
    return value;
  }
  throw new Error(
    `Pass the agent name, claude or codex, as the first argument. Received: ${value}`,
  );
}

/** The real path of a file that may not exist yet: its nearest existing folder, resolved. */
function realPath(file: string): string {
  if (existsSync(file)) {
    return realpathSync(file);
  }
  const parent = path.dirname(file);
  return parent === file ? file : path.join(realPath(parent), path.basename(file));
}

/** A Codex `apply_patch` names each file on an `Add`, `Update`, `Delete` or `Move to` line. */
const patchFile = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gmu;

/**
 * The repository-relative paths that an edit tool call writes. Claude Code
 * sends `file_path` or `notebook_path`. Codex sends the patch text in
 * `command`. A path outside the repository is dropped.
 */
export function editedFiles(payload: Payload, root: string): Array<string> {
  const input = payload.tool_input ?? {};
  const base = payload.cwd ?? root;
  const named: Array<string> = [];
  for (const key of ['file_path', 'notebook_path']) {
    const value = input[key];
    if (typeof value === 'string') {
      named.push(value);
    }
  }
  if (payload.tool_name === 'apply_patch' && typeof input.command === 'string') {
    for (const match of input.command.matchAll(patchFile)) {
      named.push(match[1].trim());
    }
  }
  // A linked folder, such as /var and /private/var on macOS, can name one file
  // two ways. Compare the real paths.
  const home = realPath(root);
  const relative = named.flatMap((file) => {
    const inside = path.relative(home, realPath(path.resolve(base, file)));
    return inside && !inside.startsWith('..') && !path.isAbsolute(inside) ? [inside] : [];
  });
  return [...new Set(relative)];
}

/** The last `count` lines of a command's output, so a hook message stays short. */
export function tail(output: string, count: number): string {
  const lines = output.trimEnd().split('\n');
  return lines.length > count
    ? [`(${lines.length - count} earlier lines left out)`, ...lines.slice(-count)].join('\n')
    : lines.join('\n');
}

/** Reads the payload from stdin, runs the hook in the current folder, and writes its outcome. */
export async function runHook(hook: Hook): Promise<void> {
  const text = await Bun.stdin.text();
  const payload: Payload = text.trim() ? JSON.parse(text) : {};
  const outcome = await hook(payload, { agent: agentOf(process.argv[2]), root: process.cwd() });
  if (outcome.stdout) {
    process.stdout.write(outcome.stdout);
  }
  if (outcome.stderr) {
    process.stderr.write(outcome.stderr);
  }
  process.exitCode = outcome.exitCode;
}
