import path from 'node:path';
import { parseArgs } from 'node:util';

import { cliRoot } from '@/format';
import { runSync } from '@/sync/run';
import type { SyncResult } from '@/sync/run';

const codes: Record<SyncResult['status'], number> = {
  unchanged: 0,
  synced: 0,
  planned: 2,
  decisions: 2,
};

function print(result: SyncResult) {
  for (const change of result.changes) {
    console.log(`${change.action.padEnd(6)} ${change.path}`);
  }
  for (const clash of result.mergeClashes) {
    console.log(`merged ${clash.file}: Clutch's value won for ${clash.key}. Check it.`);
  }
  if (result.status === 'decisions') {
    console.log(
      [
        'These managed files differ from both Clutch and the last sync, so the project edited them:',
        ...result.decisions.map((file) => `  ${file}`),
        'Nothing changed. Ask the owner whether to keep each edit or take the Clutch copy, then reconcile the file and sync again.',
      ].join('\n'),
    );
    return;
  }
  const verbs = {
    unchanged: 'is up to date with',
    planned: 'would move to',
    synced: 'moved to',
  } as const;
  console.log(`The project ${verbs[result.status]} Clutch ${result.templateCommit.slice(0, 12)}.`);
}

/** `clutch sync`: moves a project to a Clutch commit. `--check` only reports. */
export async function syncCommand(
  args: Array<string>,
  cwd: string,
  template = cliRoot,
): Promise<number> {
  try {
    const { values } = parseArgs({
      args,
      options: {
        root: { type: 'string' },
        to: { type: 'string' },
        latest: { type: 'boolean' },
        check: { type: 'boolean' },
        json: { type: 'boolean' },
      },
    });
    if (values.to && values.latest) {
      throw new Error('Pass --to <commit> or --latest, not both.');
    }
    const result = await runSync({
      root: path.resolve(cwd, values.root ?? '.'),
      template,
      to: values.latest ? 'HEAD' : values.to,
      check: values.check,
    });
    if (values.json) {
      console.log(JSON.stringify(result));
    } else {
      print(result);
    }
    return codes[result.status];
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
