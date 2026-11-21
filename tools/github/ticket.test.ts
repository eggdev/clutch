import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { noWrite } from '@tools/github/fake-run';
import { runPr } from '@tools/github/pr';
import type { Result, Run } from '@tools/github/stack';
import { ticketOf, withAcceptance } from '@tools/github/ticket';

test('a ticket branch has an id of 4 or more digits, and an issue branch names no ticket', () => {
  expect(ticketOf('clutch/cl-1000-fix-the-total')).toBe('CL-1000');
  expect(ticketOf('clutch/sh-12345')).toBe('SH-12345');
  expect(ticketOf('clutch/cl-319-first-phases')).toBeUndefined();
  expect(ticketOf('clutch/cl-319a-ticket-phases')).toBeUndefined();
  const ticket = { id: 'CL-1000', acceptance: ['The total is right.'] };
  expect(withAcceptance('Fixes it.\n', ticket)).toBe(
    'Fixes it.\n\n## Acceptance criteria\n\nFrom ticket CL-1000:\n\n- The total is right.\n',
  );
  const written = '## Acceptance criteria\n\n- Mine.\n';
  expect(withAcceptance(written, ticket)).toBe(written);
});

test('pr open on a ticket branch links the PR to the ticket, stacks it, and commits no issue file', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'pr-ticket-'));
  try {
    const body = path.join(folder, 'body.md');
    await writeFile(body, 'Fixes the total.\n');
    const top = 'clutch/cl-1000-fix-the-total-2';
    const ticket = { id: 'CL-1000', acceptance: ['The total is right.'] };
    const answers: Array<[string, Partial<Result>]> = [
      ['gh repo view', { out: 'main\n' }],
      ['git branch --show-current', { out: `${top}\n` }],
      ['bun tools/clutch.ts tickets show CL-1000', { out: JSON.stringify({ ticket }) }],
      [
        `gh pr list --state open --head ${top} `,
        {
          out: '[{"number":12,"baseRefName":"clutch/cl-1000-fix-the-total","url":"https://github.com/o/r/pull/12","isDraft":false}]',
        },
      ],
      [
        'gh pr list --state open --head clutch/cl-1000-fix-the-total ',
        {
          out: '[{"number":11,"baseRefName":"main","url":"https://github.com/o/r/pull/11","isDraft":false}]',
        },
      ],
    ];
    const calls: Array<string> = [];
    const run: Run = (command) => {
      const line = command.join(' ');
      calls.push(line);
      const answer = answers.find(([prefix]) => line.startsWith(prefix))?.[1] ?? {};
      return Promise.resolve({ ok: true, out: '', err: '', ...answer });
    };
    const args = ['open', '--title', 'fix: the total', '--body-file', body];
    expect(await runPr([...args, '--base', 'clutch/cl-1000-fix-the-total'], run, noWrite)).toBe(0);
    expect(calls).toContain(
      'bun tools/clutch.ts tickets link CL-1000 --kind pull_request https://github.com/o/r/pull/12',
    );
    expect(calls).toContain('gh stack link 11 12 --open');
    expect(calls.filter((call) => call.includes('issues'))).toEqual([]);
    expect(await readFile(body, 'utf-8')).toContain(
      'From ticket CL-1000:\n\n- The total is right.',
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
