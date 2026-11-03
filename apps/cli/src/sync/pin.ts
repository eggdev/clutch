import { fingerprint, localFile } from '@/review-source';
import type { SyncFile } from '@/sync/engine';

/**
 * The clutch CLI pin in a project's `mise.toml`. A project keeps the rest of
 * that file, so sync moves only the version of this one tool line, to the
 * release it syncs to. The rest of the file follows the usual managed rules.
 */
export const pinFile = 'mise.toml';

const pinLine = /^"github:eggdev\/clutch"\s*=\s*\{.*\}[ \t]*$/mu;
const versionValue = /version\s*=\s*"[^"]*"/u;

/** The version that mise pins: the release tag without its `v`. */
export const pinVersion = (release: string) => release.replace(/^v/u, '');

/** `text` with the clutch tool's version set to `version`, and every other byte unchanged. Null without a pin line. */
export function setPin(text: string, version: string): string | null {
  const line = pinLine.exec(text);
  if (!line || !versionValue.test(line[0])) {
    return null;
  }
  const next = line[0].replace(versionValue, `version = "${version}"`);
  return text.slice(0, line.index) + next + text.slice(line.index + line[0].length);
}

/** The part of `text` that a release does not move: the pin line with its version blanked. */
const body = (text: string) => setPin(text, '') ?? text;

/** The fingerprint of a file's body, which a release does not move. */
export const bodyHash = (text: string) => fingerprint('100644', Buffer.from(body(text)));

export type PinAnswer = 'keep' | 'take' | undefined;

export type PinInput = {
  /** The project's file, or null when it has none. */
  mine: string | null;
  /** Clutch's file at the release. */
  theirs: string;
  /** The version to pin, such as 0.41.0. */
  version: string;
  /** The body hash that the last sync recorded for the file. */
  recorded: string | undefined;
  /** The Clutch body hash that the project kept. */
  kept: string | undefined;
  answer: PinAnswer;
};

export type PinPlan = {
  /** What the file must hold, or null while a person has not decided. */
  content: string | null;
  /** The file needs a keep-or-take decision, and none has been given. */
  decision: boolean;
  /** Whether a keep-or-take decision was needed at all, so an answer is valid. */
  asked: boolean;
  /** The body hash of Clutch's file that the lineage records, or null while a decision is pending. */
  hash: string | null;
  /** The Clutch body hash that the project keeps, when it keeps one. */
  kept: string | undefined;
};

/**
 * Plans `mise.toml`. The pin always moves to the release. A change to the rest
 * of the file is a decision, as a managed file is: it is taken when Clutch's
 * body changes and the project has not edited the file since the last sync,
 * kept when the project keeps that body, and asked otherwise. A release that
 * moves only the pin therefore never asks anyone.
 */
export function planPin(input: PinInput): PinPlan {
  const { mine, theirs, version, recorded, kept, answer } = input;
  const theirsHash = bodyHash(theirs);
  if (mine === null) {
    const content = setPin(theirs, version) ?? theirs;
    return { content, decision: false, asked: false, hash: theirsHash, kept: undefined };
  }
  let candidate = mine;
  let keptHash: string | undefined;
  let asked = false;
  if (body(mine) !== body(theirs)) {
    if (recorded === bodyHash(mine)) {
      candidate = theirs;
    } else if (kept === theirsHash) {
      keptHash = theirsHash;
    } else {
      asked = true;
      if (answer === undefined) {
        return { content: null, decision: true, asked, hash: null, kept: undefined };
      }
      candidate = answer === 'take' ? theirs : mine;
      keptHash = answer === 'keep' ? theirsHash : undefined;
    }
  }
  const content = setPin(candidate, version) ?? candidate;
  return { content, decision: false, asked, hash: theirsHash, kept: keptHash };
}

/**
 * Plans the clutch pin in the project's `mise.toml`, from Clutch's file at the
 * release. Null when sync does not move it: at a commit between releases, or
 * when Clutch ships no `mise.toml`.
 */
export async function planPinFile(
  root: string,
  input: {
    template: SyncFile | null;
    release: string | null;
    recorded: string | undefined;
    kept: string | undefined;
    answer: PinAnswer;
  },
) {
  if (!input.template || !input.release) {
    return null;
  }
  const file = await localFile(root, pinFile);
  const plan = planPin({
    mine: file?.content.toString() ?? null,
    theirs: input.template.content.toString(),
    version: pinVersion(input.release),
    recorded: input.recorded,
    kept: input.kept,
    answer: input.answer,
  });
  return { file, plan };
}
