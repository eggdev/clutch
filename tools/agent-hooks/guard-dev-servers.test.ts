import { expect, test } from 'bun:test';

import { directStart, guardDevServers } from '@tools/agent-hooks/guard-dev-servers';
import type { Payload } from '@tools/agent-hooks/payload';
import { simulatorTools } from '@tools/agent-hooks/simulator-tools';

/** The lines in `lines` that `directStart` does not sort into `kind`. */
const missed = (lines: Array<string>, kind: string) =>
  lines.filter((line) => directStart(line)?.kind !== kind);

/** The decision and reason that the hook gives a payload, or null when it lets the call run. */
function answer(payload: Payload, agent: 'claude' | 'codex' = 'claude') {
  const outcome = guardDevServers(payload, { agent, root: '/repo' });
  expect(outcome.exitCode).toBe(0);
  return outcome.stdout ? JSON.parse(outcome.stdout).hookSpecificOutput : null;
}

test('a command that starts a dev server directly is named', () => {
  const blocked = [
    'vite',
    'cd apps/web && bunx vite --port 3000',
    'bun x vite dev',
    'npx vite preview',
    './node_modules/.bin/vite',
    'bun --watch src/main.ts',
    'bun run --hot src/main.ts',
    'mise exec -- bun nx run web:dev',
    'nx run-many -t dev',
    'bun nx run-many --targets=lint,dev',
    'PORTLESS_PORT=1355 bunx portless run vite',
    'portless api.acme bun src/main.ts',
    'npx expo start',
    'bunx one dev',
  ];
  expect(missed(blocked, 'server')).toEqual([]);
});

test('a command that creates, boots or erases a simulator or emulator is named', () => {
  const blocked = [
    'xcrun simctl boot "iPhone 17"',
    'xcrun simctl create test com.apple.CoreSimulator.SimDeviceType.iPhone-17',
    'xcrun simctl clone booted copy',
    'xcrun simctl erase all',
    'open -a Simulator',
    'open -g -a "Simulator.app"',
    'open /Applications/Xcode.app/Contents/Developer/Applications/Simulator.app',
    'emulator -no-snapshot -avd Pixel_9',
    '$ANDROID_HOME/emulator/emulator @Pixel_9',
    'adb -s emulator-5554 emu kill',
    'avdmanager create avd -n test -k system-images',
    'npx eas-cli simulator',
  ];
  expect(missed(blocked, 'device')).toEqual([]);
});

test('a command that makes a native build is named, through each runner', () => {
  const blocked = [
    'eas build --platform ios',
    'npx -y eas-cli build -p android --local',
    'bunx eas build:dev',
    'eas build:run -p ios',
    'mise exec -- bunx expo run:ios',
    'npx expo run:android --device',
    'bun expo prebuild --clean',
    'pnpm dlx expo prebuild',
    'yarn expo run',
    'npx one run:ios',
    'bunx one prebuild',
    'npx react-native run-ios',
    'cd apps/mobile/ios && xcodebuild -workspace App.xcworkspace -scheme App build',
    'xcrun xcodebuild -scheme App',
    'cd android && ./gradlew assembleRelease',
    'apps/mobile/android/gradlew :app:installDebug',
    '(cd android && ./gradlew bundleRelease)',
  ];
  expect(missed(blocked, 'build')).toEqual([]);
});

test('the dev command, reads and builds that make no device or native app pass', () => {
  const allowed = [
    'mise exec -- bun run dev',
    'bun run dev --check',
    'bun tools/dev.ts',
    'bunx vite build',
    'bun x vitest',
    'grep -rn vite package.json',
    'cat apps/web/vite.config.ts',
    'portless list',
    'bunx portless get api.acme',
    'nx run web:build',
    'mise exec -- bun run validate',
    'mise exec -- bun run native:build',
    'grep -rn xcodebuild docs/',
    'rg "eas build" .agents',
    'xcrun simctl list devices booted',
    'xcrun simctl io booted screenshot shot.png',
    'xcodebuild -list -workspace App.xcworkspace',
    'eas build:list --limit 5',
    'eas update --branch preview',
    'npx @expo/fingerprint fingerprint:generate',
    'adb devices',
    './gradlew tasks',
    'one build',
  ];
  expect(allowed.filter((line) => directStart(line) !== null)).toEqual([]);
});

test('both tools get a deny that names the fix for each kind', () => {
  for (const agent of ['claude', 'codex'] as const) {
    const fixFor = (command: string) =>
      answer({ tool_name: 'Bash', tool_input: { command } }, agent);
    expect(fixFor('bunx vite').permissionDecision).toBe('deny');
    expect(fixFor('bunx vite').permissionDecisionReason).toContain('mise exec -- bun run dev');
    expect(fixFor('eas build').permissionDecisionReason).toContain(
      'mise exec -- bun run native:build',
    );
    expect(fixFor('xcrun simctl boot x').permissionDecisionReason).toContain('booted simulator');
    expect(fixFor('mise exec -- bun run dev')).toBeNull();
  }
});

test('a Simulator tool build is denied, and a control call that names a device is denied', () => {
  expect(
    answer({ tool_name: simulatorTools.build, tool_input: { action: 'build', scheme: 'App' } })
      .permissionDecisionReason,
  ).toContain('mise exec -- bun run native:build');
  expect(
    answer({ tool_name: simulatorTools.build, tool_input: { action: 'build_status' } }),
  ).toBeNull();
  for (const pick of [{ device: 'iPhone 17 Pro' }, { udid: 'ABC-123' }]) {
    expect(
      answer({ tool_name: simulatorTools.control, tool_input: { action: 'attach', ...pick } })
        .permissionDecisionReason,
    ).toContain('without `device` and `udid`');
  }
  for (const action of ['attach', 'launch', 'screenshot', 'tap']) {
    expect(answer({ tool_name: simulatorTools.control, tool_input: { action } })).toBeNull();
  }
});

/** The hint that the hook gives a shell line, or null. It never sets a decision. */
function hint(command: string) {
  const outcome = guardDevServers({ tool_input: { command } }, { agent: 'claude', root: '/repo' });
  expect(outcome.exitCode).toBe(0);
  if (!outcome.stdout) {
    return null;
  }
  const output = JSON.parse(outcome.stdout);
  expect(output.hookSpecificOutput.permissionDecision).toBeUndefined();
  expect(output.systemMessage).toBe(output.hookSpecificOutput.additionalContext);
  return output.systemMessage as string;
}

test('a raw gh call that a pr command replaces runs, with a hint that names the command', () => {
  expect(hint('mise exec -- gh pr checks 72')).toContain('bun run pr status <number>');
  expect(hint('gh pr merge 72 --merge')).toContain('bun run pr merge <number>');
  expect(hint('gh stack merge 68 --merge --yes')).toContain('bun run pr merge <number>');
  expect(hint('gh run view 123 --log-failed | tail')).toContain('bun run pr failures <number>');
  expect(hint('gh run view 123 --json conclusion')).toBeNull();
  expect(hint('gh pr view 72 --json state')).toBeNull();
  expect(hint('mise exec -- bun run pr status 72')).toBeNull();
  expect(hint('cd /repo && GH_TOKEN=x gh pr checks 72')).toContain('bun run pr status');
  expect(hint(`echo "use gh pr checks 72 later"`)).toBeNull();
  expect(hint("grep -n 'gh pr merge' docs/a.md")).toBeNull();
});
