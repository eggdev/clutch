import { expect, test } from 'bun:test';

import { maestroCommand } from '@tools/native/maestro';
import type { JavaLookup } from '@tools/native/maestro';

function lookup(options: { home?: string; runs?: boolean; brew?: string }): JavaLookup {
  return {
    env: options.home ? { JAVA_HOME: options.home } : {},
    javaRuns: () => Promise.resolve(options.runs ?? false),
    exists: (file) => options.brew !== undefined && file === `${options.brew}/bin/java`,
  };
}

test('Maestro runs as it is when the machine finds Java', async () => {
  expect(await maestroCommand(['test', 'a.yaml'], lookup({ runs: true }))).toEqual([
    'maestro',
    'test',
    'a.yaml',
  ]);
  expect(await maestroCommand(['test', 'a.yaml'], lookup({ home: '/jdk' }))).toEqual([
    'maestro',
    'test',
    'a.yaml',
  ]);
});

test('a Mac with only the JDK of Homebrew gets it as JAVA_HOME', async () => {
  expect(
    await maestroCommand(['check-syntax', 'a.yaml'], lookup({ brew: '/usr/local/opt/openjdk' })),
  ).toEqual(['env', 'JAVA_HOME=/usr/local/opt/openjdk', 'maestro', 'check-syntax', 'a.yaml']);
});

test('a machine with no Java gets a sentence that names the fix', async () => {
  expect(await maestroCommand(['test', 'a.yaml'], lookup({}))).toBe(
    'Maestro runs on Java, and this machine has none. Install one with `brew install openjdk`, or set `JAVA_HOME`.',
  );
});
