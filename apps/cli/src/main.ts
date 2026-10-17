#!/usr/bin/env bun
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import { detectProject } from '@apps/cli/src/detect-project';
import { branch, installTemplate, manifestPath } from '@apps/cli/src/install-template';

/** The template repo is the clone that this CLI runs from. */
const template = path.resolve(import.meta.dir, '../../..');

const project = await detectProject(process.cwd());
if (project.kind === 'refused') {
  console.error(project.reason);
  process.exit(1);
}

const terminal = createInterface({ input: process.stdin, output: process.stdout });
const answer = await terminal.question(
  `Install the template into the existing project ${project.name}? (y/N) `,
);
terminal.close();
if (answer.trim().toLowerCase() !== 'y') {
  process.exit(0);
}

const { worktree, manifest } = await installTemplate({ project, template });
const count = (action: string) => manifest.files.filter((file) => file.action === action).length;
console.log(
  [
    `Installed into ${worktree} on branch ${branch}, from ${project.defaultBranch}.`,
    `Files: ${count('added')} added, ${count('replaced')} replaced, ${count('merged')} merged. Conflicts: ${manifest.conflicts.length}.`,
    `The manifest is ${manifestPath}.`,
  ].join('\n'),
);
