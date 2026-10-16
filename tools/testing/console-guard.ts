import { afterEach } from 'bun:test';
import { format } from 'node:util';

/**
 * Test preload, wired in bunfig.toml. An unexpected `console.error` or
 * `console.warn` fails the test that logged it. A test that expects a message
 * allows it with `allowConsole`. An allowed message that the test never logs
 * also fails the test, so the allowlist stays exact.
 */
export type ConsoleLevel = 'error' | 'warn';

type Allowed = { level: ConsoleLevel; message: string; seen: boolean };

const allowed: Array<Allowed> = [];
const unexpected: Array<string> = [];

/**
 * Allows one exact message for the rest of the current test. The message is
 * the logged arguments joined as `console` prints them, with each Error shown
 * as `Name: message`.
 */
export function allowConsole(level: ConsoleLevel, message: string): void {
  allowed.push({ level, message, seen: false });
}

/** The text that `allowConsole` compares. Errors drop their stack, so the text is stable. */
export const consoleMessage = (args: Array<unknown>) =>
  format(...args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : arg)));

for (const level of ['error', 'warn'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: Array<unknown>) => {
    const message = consoleMessage(args);
    const entry = allowed.find((item) => item.level === level && item.message === message);
    if (entry) {
      entry.seen = true;
      return;
    }
    unexpected.push(`console.${level}: ${message}`);
    original(...args);
  };
}

afterEach(() => {
  const problems = [
    ...unexpected,
    ...allowed
      .filter((item) => !item.seen)
      .map(
        (item) =>
          `allowConsole('${item.level}', ${JSON.stringify(item.message)}) matched no message.`,
      ),
  ];
  unexpected.length = 0;
  allowed.length = 0;
  if (problems.length) {
    throw new Error(
      [
        'Console guard failed.',
        'Fix the code that logs, or allow the exact message in the test:',
        "  allowConsole('warn', 'the exact message') from '@tools/testing/console-guard'.",
        'Never mock console to hide output. See docs/contributing/setup/checks.md.',
        '',
        ...problems,
      ].join('\n'),
    );
  }
});
