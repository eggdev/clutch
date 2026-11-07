import { expect, test } from 'bun:test';
import path from 'node:path';

import { main } from '@tools/journeys/run';
import type { Sink } from '@tools/journeys/run';
import { inRepo } from '@tools/testing/in-repo';

const app = JSON.stringify({
  nx: {
    tags: ['type:app'],
    targets: { dev: { executor: 'nx:run-commands', options: { command: 'one dev' } } },
  },
});

const journey = '/**\n * pay-invoice: A member pays an invoice.\n */\nexport {};\n';

/** A sink that keeps what the run writes, with the environment of a GitHub Actions run. */
function capture(env: Sink['env']) {
  const lines: Array<string> = [];
  const sink: Sink = {
    env,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
  };
  return { sink, lines };
}

test('with no web journey, --all exits 0 and warns, and the step summary names the guide', async () => {
  await inRepo(
    { 'package.json': JSON.stringify({ name: 'shop' }), 'apps/app/package.json': app },
    async (root) => {
      const summary = path.join(root, 'summary.md');
      const { sink, lines } = capture({
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_REPOSITORY: 'eggdev/neighborhood',
        GITHUB_SHA: 'abc123',
      });
      expect(await main(root, '--all', sink)).toBe(0);
      const link =
        'https://github.com/eggdev/neighborhood/blob/abc123/docs/contributing/end-to-end-testing.md';
      expect(lines).toEqual([
        'No web journey exists yet. Nothing ran.',
        `::warning title=No journey ran::No web journey exists yet, so this check tested nothing. Add one at features/<feature>/journeys/<id>.pw.ts. See ${link}`,
      ]);
      expect(await Bun.file(summary).text()).toContain(
        `Add a web journey at \`features/<feature>/journeys/<id>.pw.ts\`. See [end-to-end testing](${link}).`,
      );
    },
  );
});

test('several web apps and no journeys.webApp fail before any server starts', async () => {
  await inRepo(
    {
      'package.json': JSON.stringify({ name: 'shop' }),
      'apps/web/package.json': app,
      'apps/admin/package.json': app,
      'features/billing/journeys/pay-invoice.pw.ts': journey,
    },
    async (root) => {
      const { sink, lines } = capture({});
      expect(await main(root, '--all', sink)).toBe(1);
      expect(lines).toEqual([
        'Several apps under apps/ have a web entry: apps/admin, apps/web. Name the app that the web journeys drive in clutch.yaml with `journeys: { webApp: apps/<name> }`.',
      ]);
    },
  );
});
