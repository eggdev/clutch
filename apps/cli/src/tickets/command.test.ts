import { expect, test } from 'bun:test';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { gitRepo } from '@/testing/git-repo';
import { storeFile } from '@/tickets/store';

const main = path.join(import.meta.dir, '..', 'main.ts');

const config = (prefix: string) =>
  `schemaVersion: 1\nproject: shop\ntemplate:\n  repo: eggdev/clutch\n  mode: sync\ncapabilities: {}\ntickets:\n  prefix: ${prefix}\n`;

type Row = { phase: string; status: string; claimedBy: string | null };

/** The fields of the JSON output that the tests read. */
type Output = {
  status?: string;
  message?: string;
  missing?: Array<string>;
  ticket: { id: string; title: string; phases: Array<Row> };
  tickets: Array<unknown>;
  phases: Array<Row>;
  events: Array<{ type: string; actor: string }>;
  event: unknown;
  issues: Array<unknown>;
};

async function clutch(cwd: string, ...args: Array<string>) {
  const proc = Bun.spawn([process.execPath, main, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, json: JSON.parse(stdout) as Output };
}

const tickets = (cwd: string, ...args: Array<string>) => clutch(cwd, 'tickets', ...args);

test('a ticket added in one worktree shows in another worktree of the project, with no commit', async () => {
  await using repo = await gitRepo({ 'clutch.yaml': config('SH') });
  const other = path.join(repo.parent, 'other');
  await gitOrThrow(repo.root, 'worktree', 'add', '--quiet', '-b', 'other', other);

  const added = await tickets(repo.root, 'add', 'Fix the login', '--description', 'It breaks.');
  expect(added).toMatchObject({
    code: 0,
    json: { schemaVersion: 1, ticket: { id: 'SH-1000' } },
  });
  const shown = await tickets(other, 'show', 'SH-1000');
  expect(shown).toMatchObject({
    code: 0,
    json: { ticket: { title: 'Fix the login' } },
  });
  expect(shown.json.ticket.phases).toMatchObject([{ phase: 'triage', status: 'ready' }]);
  expect(await storeFile(other)).toBe(path.join(repo.root, '.git', 'clutch', 'tickets.sqlite'));
  expect(await gitOrThrow(repo.root, 'status', '--porcelain')).toBe('');
});

test('when 20 processes claim one phase at once, 1 exits 0 and 19 exit 1', async () => {
  await using repo = await gitRepo({ 'clutch.yaml': config('SH') });
  await tickets(repo.root, 'add', 'Race', '--description', 'One claim wins.');
  const claims = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      tickets(repo.root, 'claim', 'SH-1000', 'triage', '--as', `agent-${index}`),
    ),
  );
  const winners = claims.filter((claim) => claim.code === 0);
  expect(winners).toHaveLength(1);
  expect(claims.filter((claim) => claim.code === 1)).toHaveLength(19);
  const { json } = await tickets(repo.root, 'events', '--ticket', 'SH-1000');
  expect(json.events.map((event: { type: string }) => event.type)).toEqual([
    'Ticket',
    'Phase',
    'Phase',
  ]);
  expect(winners[0].json.ticket.phases[0].claimedBy).toBe(json.events[2].actor);
}, 60_000);

test('route exits 1 and names each missing requirement, then exits 0 once they are set', async () => {
  await using repo = await gitRepo({ 'clutch.yaml': config('SH') });
  await tickets(repo.root, 'add', 'Fix', '--description', 'x', '--hold');
  const route = ['route', 'SH-1000', '--phases', 'build,review,deploy', '--reason', 'Clear bug.'];
  const refused = await tickets(repo.root, ...route);
  expect(refused).toMatchObject({
    code: 1,
    json: { schemaVersion: 1, status: 'error' },
  });
  expect(refused.json.missing).toEqual([
    'now',
    'expected',
    'location',
    'acceptance (at least one check)',
    'major: no',
  ]);
  const edit = [
    '--now',
    'a',
    '--expected',
    'b',
    '--location',
    'c',
    '--acceptance',
    'd',
    '--major',
    'no',
  ];
  expect(await tickets(repo.root, 'edit', 'SH-1000', ...edit)).toMatchObject({
    code: 0,
  });
  expect(await tickets(repo.root, ...route)).toMatchObject({ code: 0 });
  const inbox = await tickets(repo.root, 'list', '--inbox');
  expect(inbox.json.tickets).toEqual([]);

  // The hold kept triage not_ready. Release, then finish each phase up to build.
  const released = await tickets(repo.root, 'release', 'SH-1000');
  expect(released.json.ticket.phases[0].status).toBe('ready');
  await tickets(repo.root, 'phase', 'SH-1000', 'triage', 'done');
  const ready = await tickets(repo.root, 'ready');
  expect(ready.json.phases).toMatchObject([{ phase: 'build' }]);
  const done = await tickets(repo.root, 'phase', 'SH-1000', 'build', 'done');
  expect(done.json.ticket.phases.map((row: { status: string }) => row.status)).toEqual([
    'done',
    'done',
    'ready',
    'not_ready',
  ]);
  expect(done.json.event).toMatchObject({
    type: 'Phase',
    updatedFrom: { status: 'ready' },
  });
});

test('two projects have two store files, and neither reads the tickets of the other', async () => {
  await using shop = await gitRepo({ 'clutch.yaml': config('SH') });
  await using blog = await gitRepo({ 'clutch.yaml': config('BL') });
  await tickets(shop.root, 'add', 'Shop work', '--description', 'x');
  expect(await storeFile(shop.root)).not.toBe(await storeFile(blog.root));
  expect(await tickets(blog.root, 'show', 'SH-1000')).toMatchObject({
    code: 1,
    json: { message: 'No ticket SH-1000.' },
  });
  const list = await tickets(blog.root, 'list');
  expect(list.json.tickets).toEqual([]);
  const blogTicket = await tickets(blog.root, 'add', 'Blog work', '--description', 'y');
  expect(blogTicket.json.ticket.id).toBe('BL-1000');
});

test('clutch issues prints the same output after ticket writes', async () => {
  await using repo = await gitRepo({
    'clutch.yaml': config('CL'),
    '.clutch/issues/CL-001.md':
      "---\nid: CL-001\ntitle: 'One'\nphase: P0\nstatus: todo\ndepends_on: []\npr: ''\nowner: agent\n---\n\n# CL-001: One\n",
  });
  const before = await clutch(repo.root, 'issues', '--json');
  await tickets(repo.root, 'add', 'A ticket', '--description', 'x');
  expect(await clutch(repo.root, 'issues', '--json')).toEqual(before);
  expect(before.json.issues).toHaveLength(1);
});
