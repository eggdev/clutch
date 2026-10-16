import { existsSync } from 'node:fs';
import path from 'node:path';

import { blankFences, listDocs, maskInlineCode, readDoc } from '@tools/docs-files';

/**
 * A kickoff slot is an HTML comment that starts with `kickoff:`. The kickoff
 * skill replaces each slot with project content and then deletes KICKOFF.md.
 * While KICKOFF.md exists, slots are expected. After that, a slot is a gap in
 * the docs.
 */
const slot = /<!--\s*kickoff:\s*(.*?)\s*-->/u;

export type Slot = { file: string; line: number; text: string };

export function findSlots(file: string, content: string): Array<Slot> {
  const slots: Array<Slot> = [];
  for (const [index, line] of blankFences(content).split('\n').entries()) {
    const match = slot.exec(maskInlineCode(line));
    if (match) {
      slots.push({ file, line: index + 1, text: match[1] });
    }
  }
  return slots;
}

export async function checkKickoffSlots(
  root: string,
): Promise<{ pending: boolean; slots: Array<Slot> }> {
  const slots: Array<Slot> = [];
  for (const file of await listDocs(root)) {
    slots.push(...findSlots(file, await readDoc(root, file)));
  }
  return { pending: existsSync(path.join(root, 'KICKOFF.md')), slots };
}

if (import.meta.main) {
  const { pending, slots } = await checkKickoffSlots(process.cwd());
  if (pending) {
    console.log(`Kickoff has not run. ${slots.length} slots wait for it. See KICKOFF.md.`);
  } else if (slots.length) {
    console.error(
      [
        `Kickoff slot check failed (${slots.length}).`,
        'Write the project content in place of each slot, or delete the slot when the project has no such content.',
        '',
        ...slots.map((s) => `${s.file}:${s.line}: ${s.text}`),
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Docs have no kickoff slots.');
  }
}
