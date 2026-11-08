import { readFile } from 'node:fs/promises';

import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';
import { ownerLogin } from '@tools/github/status';

/**
 * `pr ask`: a question for the owner when no T3 thread can reach them, such as
 * in a project whose owner does not run T3. It opens one GitHub issue labelled
 * `needs-owner`, assigned to the owner, in the fixed question form. See
 * .agents/skills/deliver/SKILL.md#ask-the-owner.
 */

const label = 'needs-owner';

/** The sections of the fixed question form, in the order that the owner reads them. */
const sections = ['## Goal', '## Options', '## What each option changes for users', '## My pick'];

/** The sections that `body` lacks, or that hold no text. */
export function missingSections(body: string) {
  const lines = body.split('\n').map((line) => line.trim());
  return sections.filter((section) => {
    const start = lines.indexOf(section);
    if (start === -1) {
      return true;
    }
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => line.startsWith('## '));
    return !rest.slice(0, end === -1 ? undefined : end).some(Boolean);
  });
}

/** Opens the question, or names the open issue that already asks it. Returns the exit code. */
export async function ask(run: Run, title?: string, bodyFile?: string) {
  if (!title || !bodyFile) {
    throw new Error('ask needs --title and --body-file.');
  }
  const missing = missingSections(await readFile(bodyFile, 'utf-8'));
  if (missing.length > 0) {
    throw new Error(
      `The question lacks ${missing.join(', ')}. Each section is a heading with text under it.`,
    );
  }
  const owner = await ownerLogin();
  if (!owner) {
    throw new Error(
      'No owner to ask: set automerge.owner in clutch.yaml, or a default owner in .github/CODEOWNERS.',
    );
  }
  const open = await must(run, [
    'gh',
    'issue',
    'list',
    '--state',
    'open',
    '--label',
    label,
    '--limit',
    '1000',
    '--json',
    'title,url',
  ]);
  const asked = (JSON.parse(open || '[]') as Array<{ title: string; url: string }>).find(
    (item) => item.title === title,
  );
  if (asked) {
    console.log(`Already asked: ${asked.url}`);
    return 0;
  }
  // The Labels workflow makes the label too. A project that never ran it still gets one here.
  await run(['gh', 'label', 'create', label, '--force', '--color', 'd93f0b']);
  const url = await must(run, [
    'gh',
    'issue',
    'create',
    '--title',
    title,
    '--body-file',
    bodyFile,
    '--label',
    label,
    '--assignee',
    owner,
  ]);
  console.log(`Asked the owner: ${url.trim()}`);
  return 0;
}
