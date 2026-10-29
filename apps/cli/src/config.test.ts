import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadConfig, saveConfig } from '@/config';

async function configHome() {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-config-'));
  return { dir, [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }) };
}

async function writeOld(dir: string, config: object) {
  await mkdir(path.join(dir, 'project-template'), { recursive: true });
  await writeFile(path.join(dir, 'project-template', 'config.json'), JSON.stringify(config));
}

test('settings saved under the old name move to the clutch folder once', async () => {
  await using home = await configHome();
  const env = { XDG_CONFIG_HOME: home.dir };
  await writeOld(home.dir, { agent: 'codex' });

  expect(await loadConfig(env)).toEqual({ agent: 'codex' });
  expect(JSON.parse(await readFile(path.join(home.dir, 'clutch', 'config.json'), 'utf-8'))).toEqual(
    { agent: 'codex' },
  );

  await saveConfig(env, { agent: 'claude' });
  expect(await loadConfig(env)).toEqual({ agent: 'claude' });
});

test('the clutch settings win when both folders exist', async () => {
  await using home = await configHome();
  const env = { XDG_CONFIG_HOME: home.dir };
  await writeOld(home.dir, { agent: 'codex' });
  await saveConfig(env, { agent: 'claude' });

  expect(await loadConfig(env)).toEqual({ agent: 'claude' });
});

test('no settings in either folder gives an empty config', async () => {
  await using home = await configHome();
  expect(await loadConfig({ XDG_CONFIG_HOME: home.dir })).toEqual({});
});
