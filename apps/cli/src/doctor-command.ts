import path from 'node:path';
import { parseArgs } from 'node:util';

import { loadClutchConfig } from '@/clutch-config/load';
import { baselineFile, nextBaseline, readBaseline, writeBaseline } from '@/doctor/baseline';
import { detect } from '@/doctor/detect';
import { gate } from '@/doctor/gate';
import { loadRegistry } from '@/doctor/registry';
import { buildReport, renderReport } from '@/doctor/report';
import { cliRoot } from '@/format';
import { git } from '@/git';
import { readIssues } from '@/issues/parse';

async function headCommit(root: string) {
  const head = await git(root, 'rev-parse', 'HEAD');
  return head.ok ? head.out : null;
}

/** The status of each Clutch issue in `root`. A repository without `.clutch/issues` has none. */
async function issueStatuses(root: string) {
  try {
    const { issues } = await readIssues(root);
    return new Map(issues.map((issue) => [issue.id, issue.status]));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Map<string, string>();
    }
    throw error;
  }
}

async function run(args: Array<string>, cwd: string): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      root: { type: 'string' },
      json: { type: 'boolean' },
      remote: { type: 'boolean' },
      category: { type: 'string' },
      phase: { type: 'string' },
      check: { type: 'boolean' },
      'write-baseline': { type: 'boolean' },
      'allow-downgrade': { type: 'boolean' },
    },
  });
  const root = path.resolve(cwd, values.root ?? '.');
  // The registry comes from the Clutch checkout that runs, so a project gets the registry of its Clutch commit.
  const registry = await loadRegistry(cliRoot);
  if (!registry.capabilities) {
    throw new Error(
      registry.errors
        .map((error) => `registry ${error.id} ${error.field}: ${error.message}`)
        .join('\n'),
    );
  }
  const loaded = await loadClutchConfig(root);
  if (loaded.kind === 'invalid') {
    throw new Error(
      loaded.errors.map((error) => `clutch.yaml ${error.path}: ${error.message}`).join('\n'),
    );
  }
  const config = loaded.kind === 'loaded' ? loaded.config : undefined;
  const entries = registry.capabilities.filter(
    (entry) =>
      (!values.category || entry.category === values.category) &&
      (!values.phase || entry.phase === values.phase),
  );
  const detections = await detect(root, entries, { remote: values.remote });
  const report = buildReport(entries, detections, config);
  if (values['write-baseline']) {
    const next = nextBaseline(detections, await readBaseline(root), values['allow-downgrade']);
    await writeBaseline(root, next);
    console.log(`${baselineFile} records ${Object.keys(next).length} capabilities.`);
    return 0;
  }
  if (values.check) {
    const result = gate(report.results, {
      docs: new Map(entries.map((entry) => [entry.id, entry.doc])),
      issues: await issueStatuses(root),
      today: new Date().toISOString().slice(0, 10),
      baseline: await readBaseline(root),
    });
    if (values.json) {
      console.log(JSON.stringify({ schemaVersion: 1, root, ...result }));
    } else {
      for (const finding of [...result.failures, ...result.warnings]) {
        console.log(finding.message);
      }
      if (result.code === 2) {
        console.log(
          `Improved since the baseline: ${result.improved.join(', ')}. Run: mise exec -- bun run clutch doctor --write-baseline`,
        );
      }
      console.log(
        `doctor --check: ${result.failures.length} failures, ${result.warnings.length} warnings.`,
      );
    }
    return result.code;
  }
  if (values.json) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        root,
        templateCommit: config?.template.commit ?? null,
        registryCommit: await headCommit(cliRoot),
        ...report,
      }),
    );
  } else {
    console.log(renderReport(report));
  }
  return 0;
}

/** `clutch doctor`: which capabilities a repository has, next to what its clutch.yaml declares. */
export async function doctorCommand(args: Array<string>, cwd: string): Promise<number> {
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
