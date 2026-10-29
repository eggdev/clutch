import { parseArgs } from 'node:util';

import { installReview } from '@/review-install';

export async function reviewCommand(
  args: Array<string>,
  root: string,
  template: string,
): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { check: { type: 'boolean' }, json: { type: 'boolean' } },
    });
    if (positionals.length !== 1 || positionals[0] !== 'install') {
      throw new Error('Usage: clutch review install [--check] [--json]');
    }
    const result = await installReview({ root, template, check: values.check });
    if (values.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`Review tooling: ${result.status} (${result.changes.length} changes).`);
      for (const conflict of result.conflicts) {
        console.log(`Customized file preserved: ${conflict}`);
      }
      console.log(
        'Use setup-verification to create or reconcile .agents/skills/verify/SKILL.md, then commit the project tooling.',
      );
    }
    if (result.status === 'conflict') {
      return 1;
    }
    return values.check && result.status === 'planned' ? 2 : 0;
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
