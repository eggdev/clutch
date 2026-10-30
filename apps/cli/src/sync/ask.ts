import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as prompts from '@clack/prompts';

import { gitBytes } from '@/review-source';

/** Shows the change from the project's copy of `file` to Clutch's copy at `commit`. */
async function showDiff(root: string, template: string, commit: string, file: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'clutch-sync-'));
  try {
    const theirs = path.join(dir, path.basename(file));
    const content = await gitBytes(template, ['show', `${commit}:${file}`]).catch(() =>
      Buffer.from(''),
    );
    await writeFile(theirs, content);
    const diff = Bun.spawn(
      ['git', '--no-pager', 'diff', '--no-index', '--', path.join(root, file), theirs],
      {
        stdout: 'inherit',
        stderr: 'inherit',
      },
    );
    await diff.exited;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Asks a person, file by file, whether to keep the project's edit or take
 * Clutch's copy. Returns nothing when they cancel.
 */
export async function askDecisions(options: {
  root: string;
  template: string;
  commit: string;
  files: Array<string>;
}) {
  const keep: Array<string> = [];
  const take: Array<string> = [];
  for (const file of options.files) {
    let answer: string | symbol = 'diff';
    while (answer === 'diff') {
      answer = await prompts.select({
        message: `${file} differs from Clutch. The project edited it.`,
        options: [
          {
            value: 'keep',
            label: 'Keep the project copy',
            hint: 'asks again when Clutch changes it',
          },
          { value: 'take', label: "Take Clutch's copy" },
          { value: 'diff', label: 'Show the difference first' },
        ],
      });
      if (answer === 'diff') {
        await showDiff(options.root, options.template, options.commit, file);
      }
    }
    if (prompts.isCancel(answer)) {
      return null;
    }
    (answer === 'keep' ? keep : take).push(file);
  }
  return { keep, take };
}
