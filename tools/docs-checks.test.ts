import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkDecisions } from '@tools/check-decisions';
import { checkDocsFileRefs } from '@tools/check-docs-file-refs';
import { findPhrases } from '@tools/check-docs-temporal';
import { checkFileSize } from '@tools/check-file-size';
import { checkKickoffSlots } from '@tools/check-kickoff-slots';

/** Writes the files into a new directory, runs `check` there, and deletes the directory. */
async function inRepo<T>(
  files: Record<string, string>,
  check: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'docs-check-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(join(root, dirname(name)), { recursive: true });
      await writeFile(join(root, name), content);
    }
    return await check(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('file refs reject a link or a root code path to a missing file, and skip fenced examples', async () => {
  expect(
    await inRepo(
      {
        'AGENTS.md':
          '[intent](./docs/intent.md) and `docs/gone.md`\n\n```\n[x](./docs/fenced.md)\n```\n',
        'docs/intent.md': '[back](../AGENTS.md) and `tools/proposed/new.ts`\n',
      },
      checkDocsFileRefs,
    ),
  ).toEqual(['AGENTS.md:1: `docs/gone.md` does not exist.']);
});

test('temporal language flags changelog phrases, and skips decision records and inline code', () => {
  expect(
    findPhrases('docs/a.md', 'The Worker now uses D1.\nThe `no longer` phrase.\n').map(
      (m) => m.label,
    ),
  ).toEqual(['now plus a verb']);
  expect(findPhrases('docs/contributing/decisions/0001-x.md', 'We no longer poll.')).toEqual([]);
});

test('decisions reject a duplicate number and a record the index does not list once', async () => {
  const errors = await inRepo(
    {
      'docs/contributing/decisions/index.md':
        '- [0001](./0001-push-not-poll.md)\n- [0001](./0001-push-not-poll.md)\n- [0000](./0000-template.md)\n',
      'docs/contributing/decisions/0000-template.md': '',
      'docs/contributing/decisions/0001-push-not-poll.md': '',
      'docs/contributing/decisions/0001-no-barrels.md': '',
    },
    checkDecisions,
  );
  expect(errors).toEqual([
    'docs/contributing/decisions/0001-push-not-poll.md: 0001 is also used by 0001-no-barrels.md. Renumber the later record.',
    'docs/contributing/decisions/index.md: lists 0001-no-barrels.md 0 times. List each record once.',
    'docs/contributing/decisions/index.md: lists 0001-push-not-poll.md 2 times. List each record once.',
  ]);
});

test('file size rejects an AGENTS.md over 20 lines', async () => {
  expect(await inRepo({ 'AGENTS.md': 'line\n'.repeat(20) }, checkFileSize)).toEqual([]);
  expect(await inRepo({ 'AGENTS.md': 'line\n'.repeat(21) }, checkFileSize)).toEqual([
    'AGENTS.md: 21 lines, budget 20. Move detail to the page that owns it.',
  ]);
});

test('kickoff slots are pending while KICKOFF.md exists, and inline code that names a slot is not a slot', async () => {
  const docs = {
    'docs/contributing/project-intent.md': '# Intent\n\n<!-- kickoff: who are the users -->\n',
    'AGENTS.md': 'Kickoff writes `<!-- kickoff: … -->` slots.\n',
  };
  expect(await inRepo({ ...docs, 'KICKOFF.md': '' }, checkKickoffSlots)).toEqual({
    pending: true,
    slots: [{ file: 'docs/contributing/project-intent.md', line: 3, text: 'who are the users' }],
  });
  expect((await inRepo(docs, checkKickoffSlots)).pending).toBe(false);
});
