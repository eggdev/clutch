import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'yaml';

import { agentKind } from '@/factory/agent';
import { automationKind } from '@/factory/automation';
import { benchmarkKind } from '@/factory/benchmark';
import { namePattern } from '@/factory/common';
import type { Kind } from '@/factory/common';
import { check } from '@/factory/json-schema';
import { modelsKind } from '@/factory/models';
import { runnerKind } from '@/factory/runner';
import { scorerKind } from '@/factory/scorer';
import { frontmatter } from '@/issues/parse';

/** A problem in one file of the tree. `file` is from the tree root. An empty `key` is the whole file. */
export type Problem = { file: string; key: string; reason: string };

/** One file of a kind, with its parsed settings. `data` is empty when the file does not parse. */
export type Entry = { name: string; file: string; data: Record<string, unknown> };

export type Tree = {
  agents: Array<Entry>;
  automations: Array<Entry>;
  runners: Array<Entry>;
  scorers: Array<Entry>;
  benchmarks: Array<Entry>;
  models?: Entry;
  problems: Array<Problem>;
};

const readme = 'README.md';
const name = new RegExp(namePattern, 'u');
const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function list(dir: string): Promise<Array<Dirent>> {
  try {
    const items = await readdir(dir, { withFileTypes: true });
    return items
      .filter((item) => !item.name.startsWith('.'))
      .toSorted((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/** The text of `file`, or null when it does not exist. */
async function readText(file: string) {
  try {
    return await readFile(file, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** Parses one file of `kind` and adds a problem for each way it breaks the schema. */
function readEntry(kind: Kind, file: string, text: string, problems: Array<Problem>) {
  const add = (key: string, reason: string) => problems.push({ file, key, reason });
  let yaml = text;
  let body = '';
  if (kind.format === 'markdown') {
    const block = frontmatter(text);
    if (!block) {
      add('', 'The file does not start with a --- frontmatter block.');
      return {};
    }
    ({ yaml } = block);
    body = text.slice(block.end);
  }
  let data: unknown;
  try {
    data = parse(yaml);
  } catch (error) {
    add('', `Not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
  const out: Array<{ key: string; reason: string }> = [];
  check(kind.schema, data ?? {}, '', out);
  for (const problem of out) {
    add(problem.key, problem.reason);
  }
  if (kind.body && !body.trim()) {
    add(
      'body',
      `The body is empty. It holds ${kind.body.charAt(0).toLowerCase()}${kind.body.slice(1)}`,
    );
  }
  return isMap(data) ? data : {};
}

/**
 * Reads a folder where each item is a folder with one fixed file, such as
 * `agents/<name>/agent.md`. A README.md beside the items is allowed.
 */
async function readFolders(root: string, pattern: string, problems: Array<Problem>) {
  const [folder, , fileName] = pattern.split('/');
  const found: Array<{ name: string; file: string; text: string }> = [];
  for (const item of await list(path.join(root, folder))) {
    const at = `${folder}/${item.name}`;
    if (!item.isDirectory()) {
      if (item.name !== readme) {
        problems.push({
          file: at,
          key: '',
          reason: `Unexpected file. Each item is a folder: ${pattern}.`,
        });
      }
      continue;
    }
    if (!name.test(item.name)) {
      problems.push({ file: at, key: '', reason: 'The folder name must be lowercase kebab case.' });
      continue;
    }
    const file = `${at}/${fileName}`;
    const text = await readText(path.join(root, file));
    if (text === null) {
      problems.push({ file: at, key: '', reason: `Has no ${fileName}.` });
      continue;
    }
    found.push({ name: item.name, file, text });
  }
  return found;
}

async function readKindFolders(root: string, kind: Kind, problems: Array<Problem>) {
  const found = await readFolders(root, kind.path, problems);
  return found.map(({ name: itemName, file, text }) => ({
    name: itemName,
    file,
    data: readEntry(kind, file, text, problems),
  }));
}

async function readRunners(root: string, problems: Array<Problem>) {
  const runners: Array<Entry> = [];
  for (const item of await list(path.join(root, 'runners'))) {
    const file = `runners/${item.name}`;
    const base = item.name.replace(/\.yaml$/u, '');
    if (item.name === readme) {
      continue;
    }
    if (!item.isFile() || !item.name.endsWith('.yaml')) {
      const hint = item.name.endsWith('.yml') ? ' Use the .yaml extension.' : '';
      problems.push({
        file,
        key: '',
        reason: `Unexpected. Each runner is a file runners/<name>.yaml.${hint}`,
      });
      continue;
    }
    if (!name.test(base)) {
      problems.push({ file, key: '', reason: 'The file name must be lowercase kebab case.' });
      continue;
    }
    const text = await readFile(path.join(root, file), 'utf-8');
    runners.push({ name: base, file, data: readEntry(runnerKind, file, text, problems) });
  }
  return runners;
}

/** Reads each file of the tree at `root` and checks it against its kind's schema. */
export async function readTree(root: string): Promise<Tree> {
  const problems: Array<Problem> = [];
  const agents = await readKindFolders(root, agentKind, problems);
  const automations = await readKindFolders(root, automationKind, problems);
  const runners = await readRunners(root, problems);
  const scorers = await readKindFolders(root, scorerKind, problems);
  const benchmarks = await readKindFolders(root, benchmarkKind, problems);
  const modelsText = await readText(path.join(root, modelsKind.path));
  const models =
    modelsText === null
      ? undefined
      : {
          name: 'models',
          file: modelsKind.path,
          data: readEntry(modelsKind, modelsKind.path, modelsText, problems),
        };
  return { agents, automations, runners, scorers, benchmarks, models, problems };
}
