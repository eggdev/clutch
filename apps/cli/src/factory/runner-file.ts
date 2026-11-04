import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'yaml';

import { loadClutchConfig } from '@/clutch-config/load';
import { factoryTreeRoot } from '@/factory/check';
import { namePattern } from '@/factory/common';
import { check } from '@/factory/json-schema';
import type { SchemaProblem } from '@/factory/json-schema';
import { runnerKind } from '@/factory/runner';

/** The settings of one `runners/<name>.yaml`, after the schema check. */
export type Runner = {
  readonly name: string;
  readonly machine: string;
  readonly t3Environment: string;
  readonly workspace: 'worktree' | 'main_checkout';
  /** The commands the machine needs before the project's own setup. Empty when the file has none. */
  readonly setup: ReadonlyArray<string>;
};

/**
 * Reads the runner `name` from the factory tree of the project at
 * `projectRoot`. It throws when the file is missing or breaks the runner
 * schema, so a launch never starts from a bad runner.
 */
export async function loadRunner(projectRoot: string, name: string): Promise<Runner> {
  if (!new RegExp(namePattern, 'u').test(name)) {
    throw new Error(`The runner name "${name}" must be lowercase kebab case, such as spark.`);
  }
  const loaded = await loadClutchConfig(projectRoot);
  const config = loaded.kind === 'loaded' ? loaded.config : undefined;
  const file = path.join(factoryTreeRoot(config), 'runners', `${name}.yaml`);
  const text = await readFile(path.join(projectRoot, file), 'utf-8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    },
  );
  if (text === null) {
    throw new Error(`No runner ${name}: ${file} does not exist in ${projectRoot}.`);
  }
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid YAML: ${(error as Error).message}`, { cause: error });
  }
  const problems: Array<SchemaProblem> = [];
  check(runnerKind.schema, data ?? {}, '', problems);
  if (problems.length) {
    const list = problems.map((problem) => `${problem.key || '(file)'}: ${problem.reason}`);
    throw new Error(`${file} breaks the runner schema: ${list.join('; ')}`);
  }
  const fields = data as {
    machine: string;
    t3_environment: string;
    workspace: Runner['workspace'];
    setup?: Array<string>;
  };
  return {
    name,
    machine: fields.machine,
    t3Environment: fields.t3_environment,
    workspace: fields.workspace,
    setup: fields.setup ?? [],
  };
}
