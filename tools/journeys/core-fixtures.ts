import { checkJourneys } from '@tools/check-journeys';
import { verificationFile } from '@tools/journeys/journeys';
import { inRepo } from '@tools/testing/in-repo';

/** The fixtures of the core journey rule tests: a journey header, a passing sign-up on web and native, and a repo that runs check-journeys. */

const flow = (id: string, platform = 'web') => ({
  platform,
  commands: [['mise', 'exec', '--', 'bun', 'run', 'journey', id]],
});

/** A template placeholder, built so that no string literal holds one. */
export const placeholder = (inner: string) => `$${'{'}${inner}}`;

export const core = (id: string, name: string, body: string) =>
  `/**\n * ${id}: A visitor proves a core journey.\n * Contract: docs/contributing/journeys/core.md\n * Entry: the first screen\n * Isolation and cleanup: a new account\n * Core: ${name}\n */\n${body}`;

export const signUp = [
  "import { test } from '@repo/journeys/testing/test';",
  "import { outcomes } from '@repo/journeys/testing/outcome';",
  "test('a visitor signs up', async ({ page }) => {",
  '  const outcome = outcomes(page);',
  "  await page.goto('/');",
  "  await page.getByRole('button', { name: 'Sign up' }).click();",
  "  await page.getByRole('button', { name: 'Create account' }).click();",
  "  await outcome('signed-up', { url: '/home', text: 'Welcome' });",
  "  await page.getByRole('link', { name: 'Verify email' }).click();",
  "  await outcome('email-verified', { text: 'Email verified' });",
  "  await page.getByRole('button', { name: 'Sign out' }).click();",
  "  await page.getByLabel('Email').fill('taken@example.com');",
  "  await outcome('email-taken-refused', { text: 'That email has an account' });",
  "  await page.getByLabel('Password').fill('short');",
  "  await outcome('weak-password-refused', { text: 'Use a longer password' });",
  '});',
].join('\n');

export const nativeSignUp = [
  'appId: com.example',
  '---',
  '- launchApp: { clearState: true }',
  '- tapOn: Sign up',
  "- assertVisible: { text: Welcome, label: 'outcome signed-up' }",
  '- tapOn: Verify email',
  "- assertVisible: { text: Email verified, label: 'outcome email-verified' }",
  '- tapOn: Sign out',
  '- inputText: taken@example.com',
  "- assertVisible: { text: That email has an account, label: 'outcome email-taken-refused' }",
  '- inputText: short',
  "- assertVisible: { text: Use a longer password, label: 'outcome weak-password-refused' }",
  '',
].join('\n');

export const coreRepo = (files: Record<string, string>) =>
  inRepo(
    {
      ...files,
      [verificationFile]: JSON.stringify({
        flows: Object.fromEntries(
          Object.keys(files).map((file) => {
            const id = file.split('/').at(-1)?.split('.')[0] ?? '';
            return [id, flow(id, file.endsWith('.maestro.yaml') ? 'native' : 'web')];
          }),
        ),
      }),
    },
    checkJourneys,
  );

export const see = 'See docs/contributing/journeys/core.md.';
