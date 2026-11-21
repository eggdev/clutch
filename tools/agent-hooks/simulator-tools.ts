import type { Payload } from '@tools/agent-hooks/payload';

/**
 * The iOS Simulator tools of the Claude desktop app. Codex has no such tools.
 * `.claude/settings.json` sends each of them to the `guard-dev-servers` hook,
 * and `check-agent-hooks` fails when its matcher misses one.
 */
export const simulatorTools = {
  build: 'mcp__Claude_Code_iOS_Simulator__build',
  control: 'mcp__Claude_Code_iOS_Simulator__control',
} as const;

/**
 * The reason to refuse an iOS Simulator tool call, or null to let it run.
 *
 * - `build` with the `build` action makes a native build. The native build
 *   goes through `bun run native:build`, which checks the fingerprint.
 *   `build_status` only reads.
 * - `control` with a `device` or `udid` picks a simulator by name, and can
 *   start a second one. An agent opens a pool device with T3 Code's
 *   `device_open` instead.
 */
export function simulatorToolRefusal(payload: Payload): string | null {
  const input = payload.tool_input ?? {};
  if (payload.tool_name === simulatorTools.build && input.action === 'build') {
    return 'This tool makes a native iOS build. Run `mise exec -- bun run native:build` instead. It makes a build only when no build of the native fingerprint exists. See docs/contributing/setup/native.md.';
  }
  if (
    payload.tool_name === simulatorTools.control &&
    (input.device !== undefined || input.udid !== undefined)
  ) {
    return "This call picks a simulator by name or UDID, and can start a second one. Open a device of the shared pool with T3 Code's `device_open` instead. See docs/contributing/setup/native.md#the-device-pool.";
  }
  return null;
}
