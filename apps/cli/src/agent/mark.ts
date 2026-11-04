import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readPull } from '@/agent/prompt';
import type { Gh } from '@/doctor/remote';
import { gitOrThrow } from '@/git';
import { upsertComment } from '@/pr-comment';

/** The 5 stages of a lane run, in order. */
export const stages = ['triage', 'spec', 'implement', 'review', 'verify'] as const;
export type Stage = (typeof stages)[number];

/** A stage that ran before its issue had a PR. */
type Saved = { role: Stage; head: string; note?: string };

/** The first line of a stage comment. The foreman and metrics search for it. */
const marker = (role: Stage, head: string) => `<!-- clutch-stage:${role}:${head} -->`;

function commentBody(stage: Saved, early: boolean) {
  const when = early ? ' before the PR opened' : '';
  const lines = [
    marker(stage.role, stage.head),
    `Stage \`${stage.role}\` ran on \`${stage.head.slice(0, 7)}\`${when}.`,
  ];
  if (stage.note?.trim()) {
    lines.push('', stage.note.trim());
  }
  return lines.join('\n');
}

/**
 * The file that keeps the markers of an issue's stages until its PR exists.
 * It is in the Git common folder, so each worktree of the clone sees it and
 * no commit picks it up.
 */
async function savedFile(root: string, issue: string) {
  const common = path.resolve(root, await gitOrThrow(root, 'rev-parse', '--git-common-dir'));
  return path.join(common, 'clutch-stages', `${issue}.json`);
}

async function readSaved(file: string): Promise<Array<Saved>> {
  try {
    return JSON.parse(await readFile(file, 'utf-8')) as Array<Saved>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export type MarkResult =
  | { status: 'saved'; role: Stage; head: string; file: string }
  | {
      status: 'posted';
      role: Stage;
      head: string;
      comments: Array<{ role: Stage; head: string; url: string; edited: boolean }>;
    };

/**
 * Records that a stage ran. With a PR, it posts one comment that starts with
 * the stage marker, or edits the comment with the same marker. Before the PR
 * exists, it saves the marker under the issue id, in place of an earlier one
 * of the same stage. The first mark with both the
 * PR and the issue posts the saved markers first, in the order they ran.
 */
export async function markStage(options: {
  gh: Gh;
  root: string;
  role: Stage;
  repo?: string;
  pr?: number;
  issue?: string;
  head?: string;
  note?: string;
}): Promise<MarkResult> {
  const { gh, root, role, repo, pr, issue, note } = options;
  if (pr === undefined) {
    if (!issue) {
      throw new Error('Pass --pr, or --issue for a stage that runs before the PR exists.');
    }
    const head = options.head ?? (await gitOrThrow(root, 'rev-parse', 'HEAD'));
    const file = await savedFile(root, issue);
    const earlier = await readSaved(file);
    // A stage that runs again before the PR exists replaces its own work, so only its latest marker stays.
    const saved = earlier.filter((stage) => stage.role !== role);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify([...saved, { role, head, note }], null, 2)}\n`);
    return { status: 'saved', role, head, file };
  }
  if (!repo) {
    throw new Error('No GitHub origin remote. Pass --repo OWNER/NAME.');
  }
  let { head } = options;
  if (!head) {
    const pull = await readPull(gh, repo, pr);
    ({ head } = pull);
  }
  const file = issue ? await savedFile(root, issue) : undefined;
  const saved = file ? await readSaved(file) : [];
  const comments = [];
  for (const [stage, early] of [
    ...saved.map((one) => [one, true] as const),
    [{ role, head, note }, false] as const,
  ]) {
    const prefix = marker(stage.role, stage.head);
    const comment = await upsertComment({
      gh,
      repo,
      pr,
      body: commentBody(stage, early),
      earlier: (body) => body.startsWith(prefix),
    });
    comments.push({ role: stage.role, head: stage.head, ...comment });
  }
  if (file && saved.length > 0) {
    await rm(file);
  }
  return { status: 'posted', role, head, comments };
}
