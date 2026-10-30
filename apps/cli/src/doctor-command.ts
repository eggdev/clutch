import path from 'node:path';
import { parseArgs } from 'node:util';

import { loadClutchConfig } from '@/clutch-config/load';
import { detect } from '@/doctor/detect';
import { loadRegistry } from '@/doctor/registry';
import { buildReport, renderReport } from '@/doctor/report';
import { cliRoot } from '@/format';
import { git } from '@/git';

async function headCommit(root: string) {
  const head = await git(root, 'rev-parse', 'HEAD');
  return head.ok ? head.out : null;
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
  const report = buildReport(
    entries,
    await detect(root, entries, { remote: values.remote }),
    config,
  );
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
