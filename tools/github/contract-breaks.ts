import type { ChangedFile } from '@tools/github/bot-rule';
import type { Run } from '@tools/github/stack';

const isString = (value: unknown): value is string => typeof value === 'string';

/**
 * The one-way changes that the contract snapshot at `sha` names under `breaks`,
 * when the pull request's `changed` files include `contract.json`. A pull
 * request that leaves the file alone has none, so a break counts only in the
 * pull request that makes it. A snapshot whose `breaks` is not a list of
 * strings is refused, as is any other failure of the read. The merge judge
 * and `pr status` read it, see `blockers` in `tools/github/auto-merge-rules.ts`.
 */
export async function contractBreaks(
  run: Run,
  repo: string,
  changed: Array<ChangedFile>,
  sha: string,
) {
  if (!changed.some((file) => file.filename === 'contract.json')) {
    return [];
  }
  const endpoint = `repos/${repo}/contents/contract.json?ref=${sha}`;
  const result = await run(['gh', 'api', endpoint, '--jq', '.content | @base64d']);
  if (!result.ok) {
    if (/HTTP 404/u.test(result.err)) {
      return [];
    }
    throw new Error(`gh api ${endpoint} failed: ${result.err || result.out}`);
  }
  const snapshot: unknown = JSON.parse(result.out);
  const breaks =
    typeof snapshot === 'object' && snapshot !== null && 'breaks' in snapshot
      ? snapshot.breaks
      : undefined;
  if (!Array.isArray(breaks)) {
    throw new TypeError(`contract.json at ${sha}: \`breaks\` is not a list of strings.`);
  }
  const names = breaks.filter(isString);
  if (names.length !== breaks.length) {
    throw new TypeError(`contract.json at ${sha}: \`breaks\` is not a list of strings.`);
  }
  return names;
}
