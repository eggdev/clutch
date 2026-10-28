import { expect, test } from 'bun:test';

import { directStart, guardDevServers } from '@tools/agent-hooks/guard-dev-servers';

test('a command that starts a dev server or a simulator directly is named', () => {
  const blocked = [
    'vite',
    'cd apps/web && bunx vite --port 3000',
    'bun x vite dev',
    'npx vite preview',
    'bun --watch src/main.ts',
    'bun run --hot src/main.ts',
    'mise exec -- bun nx run web:dev',
    'nx run-many -t dev',
    'bun nx run-many --targets=lint,dev',
    'PORTLESS_PORT=1355 bunx portless run vite',
    'portless api.acme bun src/main.ts',
    'npx expo start',
    'bunx expo run:ios',
    'xcrun simctl boot "iPhone 17"',
    'open -a Simulator',
    'emulator -no-snapshot -avd Pixel_9',
  ];
  expect(blocked.filter((line) => directStart(line) === null)).toEqual([]);
});

test('the dev command and commands that start no server pass', () => {
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
  ];
  expect(allowed.filter((line) => directStart(line) !== null)).toEqual([]);
});

test('both tools get a deny with the dev command in the reason', () => {
  for (const agent of ['claude', 'codex'] as const) {
    const outcome = guardDevServers(
      { tool_name: 'Bash', tool_input: { command: 'bunx vite' } },
      { agent, root: '/repo' },
    );
    expect(outcome.exitCode).toBe(0);
    const output = JSON.parse(outcome.stdout ?? '{}').hookSpecificOutput;
    expect(output.permissionDecision).toBe('deny');
    expect(output.permissionDecisionReason).toContain('mise exec -- bun run dev');
    expect(
      guardDevServers(
        { tool_name: 'Bash', tool_input: { command: 'mise exec -- bun run dev' } },
        { agent, root: '/repo' },
      ),
    ).toEqual({ exitCode: 0 });
  }
});
