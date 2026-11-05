import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { checkHarness, limits } from '@/bench/harness';
import { renderResult, resultFile, writeResult } from '@/bench/report';
import type { BenchResult } from '@/bench/report';
import { liveCheckouts, runPair } from '@/bench/run';
import type { PairResult } from '@/bench/run';
import { loadSuite, pick } from '@/bench/suite';
import { loadClutchConfig } from '@/clutch-config/load';
import { factoryTreeRoot } from '@/factory/check';
import { gitOrThrow } from '@/git';

/** Removes each scratch checkout when a person stops the run. */
function stop(signal: NodeJS.Signals) {
  for (const dir of liveCheckouts) {
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

function removeOnSignal() {
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return () => {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  };
}

/**
 * `clutch bench <name> [--config NAME] [--task NAME] [--json]`. Runs each
 * task of the suite with each config, one pair at a time. A run of the whole
 * suite writes its result file. A run with --config or --task only prints.
 */
export async function benchCommand(args: Array<string>, cwd: string) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      config: { type: 'string', multiple: true, default: [] },
      task: { type: 'string', multiple: true, default: [] },
      json: { type: 'boolean', default: false },
    },
  });
  const [name] = positionals;
  if (!name || positionals.length > 1) {
    console.error('Run clutch bench <name>, with the name of a folder in benchmarks/.');
    return 1;
  }
  const repo = await gitOrThrow(cwd, 'rev-parse', '--show-toplevel');
  const loaded = await loadClutchConfig(repo);
  if (loaded.kind === 'invalid') {
    throw new Error('clutch.yaml is not valid. Run `clutch doctor --check` to see why.');
  }
  const treeDir = path.resolve(
    repo,
    factoryTreeRoot(loaded.kind === 'loaded' ? loaded.config : undefined),
  );
  const suite = await loadSuite(treeDir, name);
  const configs = pick(suite.configs, values.config, '--config');
  const tasks = pick(suite.tasks, values.task, '--task');
  for (const config of configs) {
    checkHarness(config.harness, config.model);
  }
  const logs = await mkdtemp(path.join(tmpdir(), `clutch-bench-${name}-logs-`));
  const progress = (text: string) => (values.json ? console.error(text) : console.log(text));
  progress(
    `Running ${tasks.length} tasks with ${configs.length} configs. Each agent run stops after ${limits.minutes} minutes or ${limits.turns} turns. Logs: ${logs}`,
  );
  const runs: Array<PairResult> = [];
  const stopHandling = removeOnSignal();
  try {
    for (const task of tasks) {
      for (const config of configs) {
        const log = path.join(logs, `${task.name}-${config.name}.log`);
        const run = await runPair(repo, suite, task, config, log);
        progress(
          `${task.name} with ${config.name}: ${run.pass ? 'pass' : 'fail'} (${run.exit}, ${run.seconds}s, ${run.lines} lines)`,
        );
        runs.push(run);
      }
    }
  } finally {
    stopHandling();
  }
  const result: BenchResult = {
    benchmark: name,
    date: new Date().toISOString(),
    commit: await gitOrThrow(repo, 'rev-parse', 'HEAD'),
    agent: suite.agent,
    limits,
    runs,
  };
  const whole = values.config.length === 0 && values.task.length === 0;
  const file = whole ? resultFile(path.join(treeDir, 'benchmarks', name), result) : undefined;
  if (file) {
    await writeResult(file, result);
  }
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  console.log(`\n${renderResult(result)}\n`);
  console.log(
    file
      ? `Wrote ${path.relative(cwd, file)}.`
      : 'A run with --config or --task writes no result file.',
  );
  return 0;
}
