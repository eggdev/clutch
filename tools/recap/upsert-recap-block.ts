import { parseArgs } from 'node:util';

/**
 * Puts a system recap block into a PR description. It replaces the text
 * between the markers, or appends the block when the body has no markers. It
 * never edits text outside the markers. See .agents/skills/pr-recap/SKILL.md.
 *
 * Usage: bun tools/recap/upsert-recap-block.ts <pr-number> <block-file>
 */
export const startMarker = '<!-- system-recap:start -->';
export const endMarker = '<!-- system-recap:end -->';

const count = (text: string, marker: string) => text.split(marker).length - 1;

/** The PR body with the block in place of the old one, or appended. */
export function mergeRecapBlock(body: string, block: string): string {
  const trimmed = block.trim();
  if (
    !trimmed.startsWith(startMarker) ||
    !trimmed.endsWith(endMarker) ||
    count(trimmed, startMarker) !== 1 ||
    count(trimmed, endMarker) !== 1
  ) {
    throw new Error(
      `The block must start with "${startMarker}", end with "${endMarker}" and hold no other marker.`,
    );
  }
  const starts = count(body, startMarker);
  const ends = count(body, endMarker);
  if (starts === 0 && ends === 0) {
    return body.trim() ? `${body.trimEnd()}\n\n${trimmed}\n` : `${trimmed}\n`;
  }
  const start = body.indexOf(startMarker);
  const end = body.indexOf(endMarker);
  if (starts !== 1 || ends !== 1 || end < start) {
    throw new Error(
      `The PR body must hold one "${startMarker}" before one "${endMarker}". Fix the markers in the PR description by hand, then run again.`,
    );
  }
  return body.slice(0, start) + trimmed + body.slice(end + endMarker.length);
}

/** Runs `gh` and returns its standard output, or throws with its message. */
function gh(args: Array<string>, stdin?: string): string {
  const result = Bun.spawnSync(['gh', ...args], {
    stdin: stdin === undefined ? 'ignore' : Buffer.from(stdin),
  });
  if (result.exitCode !== 0) {
    throw new Error(`\`gh ${args.join(' ')}\` failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

if (import.meta.main) {
  const { positionals } = parseArgs({ allowPositionals: true });
  const [pr, blockFile] = positionals;
  if (!(pr && blockFile)) {
    throw new Error('Usage: bun tools/recap/upsert-recap-block.ts <pr-number> <block-file>');
  }
  const body = gh(['pr', 'view', pr, '--json', 'body', '--jq', '.body']);
  const next = mergeRecapBlock(body, await Bun.file(blockFile).text());
  try {
    gh(['pr', 'edit', pr, '--body-file', '-'], next);
    console.log(`The recap block on PR #${pr} is up to date.`);
  } catch (error) {
    console.error(
      `${error instanceof Error ? error.message : String(error)}\nPaste the body below into PR #${pr} by hand.`,
    );
    console.log(next);
    process.exitCode = 1;
  }
}
