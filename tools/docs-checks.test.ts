import { expect, test } from 'bun:test';

import { checkDecisions } from '@tools/check-decisions';
import { checkDocsFileRefs } from '@tools/check-docs-file-refs';
import { findPhrases } from '@tools/check-docs-temporal';
import { checkFileSize } from '@tools/check-file-size';
import { checkKickoffSlots } from '@tools/check-kickoff-slots';
import { checkUserDocs } from '@tools/check-user-docs';
import { inRepo } from '@tools/testing/in-repo';

/** A short decision record with the given status line. */
const decision = (status: string) =>
  `# A decision\n\n- **Status:** ${status}\n- **Date:** 2026-10-16\n\n## Consequences\n\n**Revisit if:** usage doubles.\n`;

/** A file of `count` short lines. */
const sourceLines = (count: number) => 'x\n'.repeat(count);

/** A user doc with the given id and any extra frontmatter. */
const userDoc = (id: string, extra = '') =>
  `---\nid: ${id}\ntitle: Connect\nsummary: Load this when a user connects.\ntype: integration\n${extra}---\n\n# Connect\n`;

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
        '## Steering list\n\n- [0001](./0001-push-not-poll.md)\n- [0001](./0001-push-not-poll.md)\n- [0000](./0000-template.md)\n\n## Historical\n',
      'docs/contributing/decisions/0000-template.md': '',
      'docs/contributing/decisions/0001-push-not-poll.md': decision('accepted'),
      'docs/contributing/decisions/0001-no-barrels.md': decision('accepted'),
    },
    checkDecisions,
  );
  expect(errors).toEqual([
    'docs/contributing/decisions/0001-push-not-poll.md: 0001 is also used by 0001-no-barrels.md. Renumber the later record.',
    'docs/contributing/decisions/index.md: lists 0001-no-barrels.md 0 times. List each record once.',
    'docs/contributing/decisions/index.md: lists 0001-push-not-poll.md 2 times. List each record once.',
  ]);
});

test('decisions need a known status that names a later record, a revisit-if, the word limit, and the right index section', async () => {
  const errors = await inRepo(
    {
      'docs/contributing/decisions/index.md': [
        '## Steering list',
        '- [0001](./0001-poll.md)',
        '- [0003](./0003-push.md)',
        '- [0004](./0004-long.md)',
        '- [0005](./0005-unknown.md)',
        '## Historical',
        '- [0002](./0002-cache.md)',
      ].join('\n'),
      'docs/contributing/decisions/0001-poll.md': decision('superseded by [0003](./0003-push.md)'),
      'docs/contributing/decisions/0002-cache.md': decision(
        'amended by [0003](./0003-push.md), [0001](./0001-poll.md)',
      ),
      'docs/contributing/decisions/0003-push.md': decision('accepted').replace(
        /\*\*Revisit if:\*\*.*/u,
        '',
      ),
      'docs/contributing/decisions/0004-long.md': decision('accepted') + ' word'.repeat(500),
      'docs/contributing/decisions/0005-unknown.md': decision('amended in place'),
    },
    checkDecisions,
  );
  expect(errors).toEqual([
    'docs/contributing/decisions/0002-cache.md: the status links 0001-poll.md. It must name a later record.',
    'docs/contributing/decisions/0003-push.md: add a "**Revisit if:**" line with the condition that reopens the decision.',
    'docs/contributing/decisions/0004-long.md: 515 words, limit 500. Split it into two decisions, or move the design to an architecture page.',
    'docs/contributing/decisions/0005-unknown.md: the status must be "accepted", "superseded by [NNNN](./NNNN-slug.md)" or "amended by [NNNN](./NNNN-slug.md)".',
    'docs/contributing/decisions/index.md: 0001-poll.md is superseded. List it under "Historical".',
    'docs/contributing/decisions/index.md: 0002-cache.md is in force. List it under "Steering list".',
  ]);
});

test('file size holds AGENTS.md to 20 lines and each source file to the limit or its reasoned budget', async () => {
  const budgets = {
    limit: 10,
    files: {
      'tools/deep.ts': { lines: 15, reason: 'One parser with shared state.' },
      'tools/grown.ts': { lines: 12, reason: 'One plugin.' },
      'tools/small.ts': { lines: 20, reason: 'Was large.' },
      'tools/silent.ts': { lines: 20, reason: ' ' },
      'tools/gone.ts': { lines: 20, reason: 'Deleted.' },
    },
  };
  expect(
    await inRepo(
      {
        'AGENTS.md': sourceLines(21),
        'tools/file-size-budgets.json': JSON.stringify(budgets),
        'tools/deep.ts': sourceLines(15),
        'tools/grown.ts': sourceLines(13),
        'tools/small.ts': sourceLines(10),
        'tools/silent.ts': sourceLines(11),
        'tools/large.ts': sourceLines(11),
        'packages/x/node_modules/dep.js': sourceLines(50),
      },
      checkFileSize,
    ),
  ).toEqual([
    'AGENTS.md: 21 lines, budget 20. Move detail to the page that owns it.',
    'tools/file-size-budgets.json: tools/gone.ts does not exist. Delete its entry.',
    'tools/grown.ts: 13 lines, budget 12. Split the file, or raise the budget and update its reason in the same change.',
    'tools/large.ts: 11 lines, limit 10. Split the file, or add an entry with a reason to tools/file-size-budgets.json.',
    'tools/silent.ts: the budget entry has no reason. Say why the file stays deep.',
    'tools/small.ts: 10 lines is within the limit of 10. Delete its budget entry.',
  ]);
});

test('file size skips files that Git ignores, such as build output', async () => {
  expect(
    await inRepo(
      {
        '.gitignore': 'dist/\n',
        'tools/file-size-budgets.json': JSON.stringify({ limit: 10, files: {} }),
        'apps/web/dist/bundle.js': sourceLines(50),
        'apps/web/src/large.ts': sourceLines(11),
      },
      (root) => {
        Bun.spawnSync(['git', 'init', '-q'], { cwd: root });
        return checkFileSize(root);
      },
    ),
  ).toEqual([
    'apps/web/src/large.ts: 11 lines, limit 10. Split the file, or add an entry with a reason to tools/file-size-budgets.json.',
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
  const done = await inRepo(docs, checkKickoffSlots);
  expect(done.pending).toBe(false);
});

test('user docs reject missing frontmatter, bad fields, a wrong id and a duplicate id, and skip README.md', async () => {
  expect(
    await inRepo(
      {
        'docs/users/README.md': '# User docs\n',
        'docs/users/connect-calendar.md': userDoc('connect_calendar'),
        'docs/users/copy.md': userDoc('connect_calendar'),
        'docs/users/bare.md': '# Bare\n',
        'docs/users/odd.md': userDoc('odd', 'audience: people\nowner: me\n').replace(
          'integration',
          'guide',
        ),
      },
      checkUserDocs,
    ),
  ).toEqual([
    'docs/users/bare.md: the page has no frontmatter.',
    'docs/users/copy.md: `id` is `connect_calendar`. The file name gives `copy`.',
    'docs/users/copy.md: `id: connect_calendar` is also used by docs/users/connect-calendar.md.',
    'docs/users/odd.md: `owner` is not a frontmatter field.',
    'docs/users/odd.md: `type: guide` is not one of intro, getting-started, concept, playbook, integration, reference.',
    'docs/users/odd.md: `audience` can only be `agents`.',
  ]);
});
