import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Gh } from '@/doctor/remote';
import { upsertComment } from '@/pr-comment';

/** The orphan branch that holds the screenshots, so the default branch never does. */
const shotsBranch = 'verify-shots';

/** GitHub shows an image of up to 10 MB in a comment. */
const maxBytes = 10 * 1024 * 1024;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const markerPattern = /<!-- clutch-verify:([0-9a-f]{40}) -->/u;

/** The marker that starts a verify comment. It names the head commit that verify checked. */
export const verifyMarker = (head: string) => `<!-- clutch-verify:${head} -->`;

/** The head commit in a comment's verify marker, or nothing. */
export const parseVerifyMarker = (body: string) => markerPattern.exec(body)?.[1];

export type Shot = { name: string; bytes: Buffer };

/** Reads each PNG file. A shot's name is its file name without `.png`. */
export async function readShots(files: Array<string>): Promise<Array<Shot>> {
  if (files.length === 0) {
    throw new Error('Name at least one PNG file.');
  }
  const shots: Array<Shot> = [];
  for (const file of files) {
    const name = path.basename(file).replace(/\.png$/iu, '');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) {
      throw new Error(`${file}: use only letters, digits, ".", "_" and "-" in the file name.`);
    }
    if (shots.some((shot) => shot.name === name)) {
      throw new Error(`${file}: two files have the name ${name}.`);
    }
    const bytes = await readFile(file);
    if (!bytes.subarray(0, 8).equals(pngSignature)) {
      throw new Error(`${file} is not a PNG file.`);
    }
    if (bytes.length > maxBytes) {
      throw new Error(`${file} has ${bytes.length} bytes. The limit is ${maxBytes}.`);
    }
    shots.push({ name, bytes });
  }
  return shots;
}

type Api = (args: Array<string>, body?: unknown) => Promise<unknown>;

/**
 * Calls `gh api`. A body goes through a file with `--input`, because one
 * argument cannot hold a large image. A failure throws with gh's message and
 * keeps its HTTP code, so a caller can tell a 404 or a 422.
 */
function restApi(gh: Gh, dir: string): Api {
  let count = 0;
  return async (args, body) => {
    let input: Array<string> = [];
    if (body !== undefined) {
      count += 1;
      const file = path.join(dir, `body-${count}.json`);
      await writeFile(file, JSON.stringify(body));
      input = ['--input', file];
    }
    const result = await gh(['api', ...args, ...input]);
    if (!result.ok) {
      throw new Error(`gh api ${args.join(' ')}: ${result.err.trim() || 'failed'}`);
    }
    return JSON.parse(result.out || 'null');
  };
}

const httpCode = (error: unknown) =>
  Number(/\(HTTP (\d{3})\)/u.exec(error instanceof Error ? error.message : '')?.[1] ?? 0);

/** The commit at the tip of the shots branch, or nothing when the branch does not exist. */
async function branchTip(api: Api, repo: string) {
  try {
    const ref = (await api([`repos/${repo}/git/ref/heads/${shotsBranch}`])) as {
      object: { sha: string };
    };
    return ref.object.sha;
  } catch (error) {
    if (httpCode(error) === 404) {
      return;
    }
    throw error;
  }
}

/**
 * Commits the shots to the shots branch under `<pr>/<head>/<name>.png`, with
 * the Git data API. Nothing touches the local checkout, so no Git hook runs.
 * When another run moves the branch first, it tries again on the new tip.
 * Returns the new commit and the path of each shot.
 */
async function commitShots(options: {
  api: Api;
  repo: string;
  pr: number;
  head: string;
  shots: Array<Shot>;
}) {
  const { api, repo, pr, head, shots } = options;
  const blobs = [];
  for (const shot of shots) {
    const blob = (await api(['-X', 'POST', `repos/${repo}/git/blobs`], {
      content: shot.bytes.toString('base64'),
      encoding: 'base64',
    })) as { sha: string };
    blobs.push({ path: `${pr}/${head}/${shot.name}.png`, sha: blob.sha });
  }
  for (let attempt = 1; ; attempt += 1) {
    const parent = await branchTip(api, repo);
    const baseTree = parent
      ? (
          (await api([`repos/${repo}/git/commits/${parent}`])) as {
            tree: { sha: string };
          }
        ).tree.sha
      : undefined;
    const tree = (await api(['-X', 'POST', `repos/${repo}/git/trees`], {
      ...(baseTree ? { base_tree: baseTree } : {}),
      tree: blobs.map((blob) => ({
        path: blob.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      })),
    })) as { sha: string };
    const commit = (await api(['-X', 'POST', `repos/${repo}/git/commits`], {
      message: `chore(verify): add the screenshots of #${pr} at ${head.slice(0, 7)}`,
      tree: tree.sha,
      parents: parent ? [parent] : [],
    })) as { sha: string };
    try {
      await (parent
        ? api(['-X', 'PATCH', `repos/${repo}/git/refs/heads/${shotsBranch}`], {
            sha: commit.sha,
            force: false,
          })
        : api(['-X', 'POST', `repos/${repo}/git/refs`], {
            ref: `refs/heads/${shotsBranch}`,
            sha: commit.sha,
          }));
      return { commit: commit.sha, paths: blobs.map((blob) => blob.path) };
    } catch (error) {
      if (httpCode(error) !== 422 || attempt === 3) {
        throw error;
      }
    }
  }
}

export function commentBody(options: {
  repo: string;
  head: string;
  note?: string;
  images: Array<{ name: string; url: string }>;
}) {
  const { repo, head } = options;
  const lines = [
    verifyMarker(head),
    `**Verify** checked the head commit [${head.slice(0, 7)}](https://github.com/${repo}/commit/${head}).`,
    '',
  ];
  if (options.note?.trim()) {
    lines.push(options.note.trim(), '');
  }
  for (const image of options.images) {
    lines.push(`**${image.name}**`, '', `![${image.name}](${image.url})`, '');
  }
  lines.push('`clutch verify post` posted this comment. A new run edits it.');
  return `${lines.join('\n')}\n`;
}

/**
 * Commits the screenshots to the shots branch and posts one verify comment on
 * the pull request. A PR has one verify comment: a second run edits it, and
 * its marker then names the new head commit. When `head` is given and the PR
 * head is another commit, it posts nothing, since the shots show old code.
 */
export async function postShots(options: {
  gh: Gh;
  repo: string;
  pr: number;
  files: Array<string>;
  head?: string;
  note?: string;
}) {
  const { gh, repo, pr } = options;
  const shots = await readShots(options.files);
  const dir = await mkdtemp(path.join(tmpdir(), 'clutch-verify-'));
  try {
    const api = restApi(gh, dir);
    const pull = (await api([`repos/${repo}/pulls/${pr}`])) as {
      head: { sha: string };
    };
    const head = pull.head.sha;
    if (options.head && options.head !== head) {
      throw new Error(
        `The head of #${pr} is ${head.slice(0, 7)}, not ${options.head.slice(0, 7)}. Drive the app on the new head, then post again.`,
      );
    }
    const { commit, paths } = await commitShots({ api, repo, pr, head, shots });
    const images = shots.map((shot, index) => ({
      name: shot.name,
      url: `https://github.com/${repo}/blob/${commit}/${paths[index]}?raw=true`,
    }));
    const comment = await upsertComment({
      gh,
      repo,
      pr,
      body: commentBody({ repo, head, note: options.note, images }),
      earlier: (body) => parseVerifyMarker(body) !== undefined,
    });
    return { head, commit, images, comment };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
