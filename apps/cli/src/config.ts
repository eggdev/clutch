import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type Config = { agent?: string };

function configBase(env: Record<string, string | undefined>) {
  return env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

/** The user's settings for this CLI, in the XDG config folder. */
function configFile(env: Record<string, string | undefined>) {
  return path.join(configBase(env), 'clutch', 'config.json');
}

/** Where the CLI kept its settings before the rename to Clutch. */
function oldConfigFile(env: Record<string, string | undefined>) {
  return path.join(configBase(env), 'project-template', 'config.json');
}

/** Copies the settings from the old folder once, when the new file does not exist yet. */
async function migrateOldConfig(env: Record<string, string | undefined>) {
  const file = configFile(env);
  if ((await Bun.file(file).exists()) || !(await Bun.file(oldConfigFile(env)).exists())) {
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await copyFile(oldConfigFile(env), file);
}

export async function loadConfig(env: Record<string, string | undefined>): Promise<Config> {
  await migrateOldConfig(env);
  try {
    return JSON.parse(await readFile(configFile(env), 'utf-8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function saveConfig(env: Record<string, string | undefined>, config: Config) {
  const file = configFile(env);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
}
