import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkProposals, folder, staleProposals } from '@tools/check-proposals';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'proposals-'));
  mkdirSync(path.join(root, folder), { recursive: true });
  return {
    root,
    write(file: string, content: string) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), content);
    },
    [Symbol.dispose]() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const prototype = 'apps/web/src/proposals/approval.tsx';

function record(fields: Record<string, string>) {
  const base: Record<string, string> = {
    title: 'Approval',
    status: 'proposed',
    date: '2026-11-01',
    issue: 'CL-001',
    screen: 'apps/web/src/approval.tsx',
    prototype,
    gallery: '/proposals/approval',
    directions: '[today, a, b]',
    ...fields,
  };
  const lines = Object.entries(base)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n\n# Approval\n`;
}

test('a proposal with its prototype and two directions passes', () => {
  using files = fixture();
  files.write(prototype, 'export {};\n');
  files.write(`${folder}/approval.md`, record({}));
  expect(checkProposals(files.root)).toEqual([]);
});

test('a proposal needs today and two or three directions', () => {
  using files = fixture();
  files.write(prototype, 'export {};\n');
  files.write(`${folder}/approval.md`, record({ directions: '[a, b]' }));
  files.write(`${folder}/four.md`, record({ directions: '[today, a, b, c, d]' }));
  expect(checkProposals(files.root)).toEqual([
    `${folder}/approval.md: \`directions\` lists \`today\` and 2 or 3 other directions.`,
    `${folder}/four.md: \`directions\` lists \`today\` and 2 or 3 other directions.`,
  ]);
});

test('an unknown status fails', () => {
  using files = fixture();
  files.write(`${folder}/approval.md`, record({ status: 'draft' }));
  expect(checkProposals(files.root)).toEqual([
    `${folder}/approval.md: the status must be one of proposed, adopted, current, historical.`,
  ]);
});

test('a proposed record whose prototype is missing fails', () => {
  using files = fixture();
  files.write(`${folder}/approval.md`, record({}));
  expect(checkProposals(files.root)).toEqual([
    `${folder}/approval.md: the prototype ${prototype} does not exist.`,
  ]);
});

test('an adoption names one of its directions and the decision date', () => {
  using files = fixture();
  files.write(prototype, 'export {};\n');
  files.write(`${folder}/approval.md`, record({ status: 'adopted', adopted: 'today' }));
  expect(checkProposals(files.root)).toEqual([
    `${folder}/approval.md: \`adopted\` names the direction the owner chose, from \`directions\`.`,
    `${folder}/approval.md: add the \`decided\` date of the owner choice, as YYYY-MM-DD.`,
  ]);
});

test('a current record whose prototype code is still there fails', () => {
  using files = fixture();
  files.write(prototype, 'export {};\n');
  files.write('apps/web/src/approval.tsx', 'export {};\n');
  files.write(
    `${folder}/approval.md`,
    record({ status: 'current', adopted: 'b', decided: '2026-11-02' }),
  );
  expect(checkProposals(files.root)).toEqual([
    `${folder}/approval.md: the proposal is current, so delete its prototype ${prototype}.`,
  ]);
});

test('a historical record says why it retired', () => {
  using files = fixture();
  files.write(`${folder}/approval.md`, record({ status: 'historical' }));
  expect(checkProposals(files.root)).toEqual([
    `${folder}/approval.md: say in \`retired\` why the design is no longer in use, or name the proposal that replaced it.`,
  ]);
});

test('the stale list names an old proposal and an adoption whose issue is done', () => {
  using files = fixture();
  files.write(prototype, 'export {};\n');
  files.write(`${folder}/old.md`, record({ date: '2026-10-01' }));
  files.write(`${folder}/new.md`, record({ date: '2026-11-01' }));
  files.write(
    `${folder}/built.md`,
    record({ status: 'adopted', adopted: 'a', decided: '2026-11-02', issue: 'CL-002' }),
  );
  files.write('.clutch/issues/CL-002.md', '---\nid: CL-002\nstatus: done\n---\n');
  expect(checkProposals(files.root)).toEqual([]);
  expect(staleProposals(files.root, '2026-11-03')).toEqual([
    `${folder}/built.md: CL-002 is done. Mark the proposal current and delete ${prototype}.`,
    `${folder}/old.md: proposed 33 days ago with no choice. Ask the owner again, or retire it as historical.`,
  ]);
});
