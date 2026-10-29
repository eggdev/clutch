import type { HookContext, Outcome, Payload } from '@tools/agent-hooks/payload';
import { simulatorToolRefusal } from '@tools/agent-hooks/simulator-tools';

/** What a refused command does: start a dev server, drive a device, or make a native build. */
type Kind = 'server' | 'device' | 'build';

/**
 * Commands that an agent never runs directly. Each pattern reads one command
 * of a shell line, after its `VAR=value` prefixes, its runner and the folder
 * of its program.
 *
 * - A dev server: it would start a second copy next to a server that already
 *   runs. `mise exec -- bun run dev` uses a running server again.
 * - A device: an agent reuses the booted simulator or emulator. It never
 *   creates, clones, boots or erases one.
 * - A native build: `mise exec -- bun run native:build` builds only when the
 *   native fingerprint changed.
 */
const direct: ReadonlyArray<[kind: Kind, label: string, pattern: RegExp]> = [
  ['server', 'a Vite dev server', /^vite(?:\s+(?:dev|serve|preview)\b|\s+--|\s*$)/u],
  ['server', 'bun --watch or bun --hot', /^bun\s+(?:run\s+)?--(?:watch|hot)\b/u],
  [
    'server',
    'an Nx dev target',
    /^nx\s+(?:run\s+\S+:dev\b|run-many\b.*(?:-t|--targets?)[\s=]+\S*\bdev\b|dev\b|serve\b)/u,
  ],
  ['server', 'portless', /^portless(?!\s+(?:list|get|doctor|help|--help|-h)\b)/u],
  ['server', 'the Expo dev server', /^expo\s+start\b/u],
  ['server', 'the One dev server', /^one\s+(?:dev|serve)\b/u],
  [
    'device',
    'an iOS simulator',
    /^(?:(?:xcrun\s+)?simctl\s+(?:create|clone|boot|erase)\b|open\s+(?:-\S+\s+)*-a\s+["']?Simulator(?:\.app)?["']?(?:\s|$)|open\s+\S*Simulator\.app\b)/u,
  ],
  [
    'device',
    'an Android emulator',
    /^(?:emulator\s+(?:.*\s)?(?:-avd\b|@\S)|adb\b.*\semu\b|avdmanager\s+create\b)/u,
  ],
  ['device', 'an EAS cloud simulator', /^eas(?:-cli)?\s+simulator(?![:\w-])/u],
  [
    'build',
    'an EAS build',
    /^eas(?:-cli)?\s+build(?!:(?:list|view|cancel|delete|download|configure|version)\b)(?:\s|:|$)/u,
  ],
  ['build', 'an Expo native build', /^expo\s+(?:run(?::\S+)?|prebuild)\b/u],
  ['build', 'a One native build', /^one\s+(?:run:\S+|prebuild)\b/u],
  ['build', 'a React Native build', /^react-native\s+(?:run|build)-(?:ios|android)\b/u],
  [
    'build',
    'an Xcode build',
    /^(?:xcrun\s+)?xcodebuild(?!\s+-(?:list|version|showsdks|showBuildSettings|showdestinations|help)\b)/u,
  ],
  ['build', 'a Gradle build', /^gradlew?(?:\.bat)?\b.*(?:\s|:)(?:assemble|bundle|install)\w*/u],
];

/** The runners and prefixes that can stand before the command itself. */
const prefix =
  /^(?:(?:[A-Z_][A-Z0-9_]*=\S*\s+)+|env\s+|mise\s+exec\s+--\s+|(?:bunx|npx|pnpx|pnpm\s+exec|pnpm\s+dlx|npm\s+exec(?:\s+--)?|yarn(?:\s+dlx)?|bun\s+x|bun\s+run(?!\s+--)|bun(?=\s+(?:nx|vite|portless|expo|eas|one|react-native)\b))(?:\s+-{1,2}[\w-]+(?:=\S+)?)*\s+)/u;

function stripPrefixes(command: string): string {
  let rest = command.trim();
  for (let previous = ''; previous !== rest;) {
    previous = rest;
    rest = rest.replace(prefix, '').trim();
  }
  // `./gradlew` and `$ANDROID_HOME/emulator/emulator` name the program by its path.
  return rest.replace(/^\S*\//u, '');
}

/** What a shell line starts, when it starts a refused command itself. */
export function directStart(line: string): { kind: Kind; label: string } | null {
  for (const part of line.split(/&&|\|\||[;|\n]/u)) {
    const command = stripPrefixes(part.replace(/^\s*\(+/u, ''));
    const hit = direct.find((entry) => entry[2].test(command));
    if (hit) {
      return { kind: hit[0], label: hit[1] };
    }
  }
  return null;
}

const fixes: Record<Kind, string> = {
  server:
    'Run `mise exec -- bun run dev` instead. It uses running dev servers again and starts only the missing ones. `mise exec -- bun run dev --check` shows which run. See docs/contributing/setup/local-development.md.',
  device:
    'An agent reuses the booted simulator or emulator through the device host. It never creates, clones, boots or erases one. Ask the owner to boot a device. See docs/contributing/setup/native.md.',
  build:
    'Run `mise exec -- bun run native:build` instead. It builds only when the native fingerprint changed, and refuses a JavaScript-only change. See docs/contributing/setup/native.md.',
};

const deny = (reason: string): Outcome => ({
  exitCode: 0,
  stdout: `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  })}\n`,
});

/**
 * Before a tool call, refuse a shell command that starts a dev server, a
 * device or a native build directly. Both Claude Code and Codex send the shell
 * line in `tool_input.command`, and both read a `deny` decision. Claude Code
 * also sends its iOS Simulator tools here; see `simulator-tools.ts`.
 */
export function guardDevServers(payload: Payload, _context: HookContext): Outcome {
  const refusal = simulatorToolRefusal(payload);
  if (refusal) {
    return deny(refusal);
  }
  const line = payload.tool_input?.command;
  const hit = typeof line === 'string' ? directStart(line) : null;
  if (!hit) {
    return { exitCode: 0 };
  }
  const where = hit.kind === 'server' ? ', next to any server that already runs' : '';
  return deny(`This command starts ${hit.label} directly${where}. ${fixes[hit.kind]}`);
}
