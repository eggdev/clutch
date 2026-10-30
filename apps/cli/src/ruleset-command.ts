import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { originRepo, runGh } from '@/doctor/remote';
import { applyRulesets, compareRulesets, renderRulesets } from '@/ruleset/ruleset';

async function run(args: Array<string>, cwd: string): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      root: { type: 'string' },
      repo: { type: 'string' },
      apply: { type: 'boolean' },
      json: { type: 'boolean' },
    },
  });
  const root = path.resolve(cwd, values.root ?? '.');
  const repo = values.repo ?? (await originRepo(root));
  if (!repo) {
    throw new Error('No GitHub origin remote. Pass --repo OWNER/NAME.');
  }
  if (values.apply) {
    const folder = await mkdtemp(path.join(tmpdir(), 'clutch-ruleset-'));
    try {
      let count = 0;
      const done = await applyRulesets(root, repo, runGh, async (body) => {
        count += 1;
        const file = path.join(folder, `ruleset-${count}.json`);
        await writeFile(file, body);
        return file;
      });
      for (const item of done) {
        console.log(`Ruleset ${item.name}: ${item.action} on ${repo} from ${item.file}.`);
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }
  const states = await compareRulesets(root, repo, runGh);
  console.log(
    values.json
      ? JSON.stringify({ schemaVersion: 1, repo, rulesets: states })
      : renderRulesets(states),
  );
  return states.every((item) => item.state === 'matches') ? 0 : 2;
}

/** `clutch ruleset`: compare the ruleset files with GitHub, and with --apply, create or update them. */
export async function rulesetCommand(args: Array<string>, cwd: string): Promise<number> {
  try {
    return await run(args, cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.includes('--json')) {
      console.log(JSON.stringify({ schemaVersion: 1, status: 'error', message }));
    } else {
      console.error(message);
    }
    return 1;
  }
}
