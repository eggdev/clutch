/**
 * The contact sheet of the weekly digest: each screenshot baseline that
 * changed on the checked-out branch in the last days, before and after.
 *
 *   bun tools/journeys/visual-digest.ts --root <checkout> --repo <owner/name> [--days 7]
 *
 * It reads `git log` in the checkout, which needs its history, and makes no
 * GitHub API call. The pictures link to the files at each commit. See
 * docs/contributing/capabilities/factory-observability.md#weekly-digest.
 */
import { parseArgs } from 'node:util';

export type Change = {
  readonly sha: string;
  readonly subject: string;
  readonly path: string;
  readonly status: 'added' | 'changed' | 'removed';
};

/** The most rows the sheet shows. The rest are counted. */
export const maxRows = 40;

const statuses: Record<string, Change['status']> = { A: 'added', M: 'changed', D: 'removed' };

/**
 * The baseline changes in `git log --format=%x00%H%x09%s --name-status` output,
 * newest commit first.
 */
export function parseLog(log: string): Array<Change> {
  return log
    .split('\0')
    .filter(Boolean)
    .flatMap((entry) => {
      const [head = '', ...lines] = entry.split('\n');
      const [sha = '', subject = ''] = head.split('\t');
      return lines.flatMap((line) => {
        const [status = '', file = ''] = line.split('\t');
        const kind = statuses[status];
        return kind && /(?:^|\/)__screenshots__\/[^/]+\.png$/u.test(file)
          ? [{ sha, subject, path: file, status: kind }]
          : [];
      });
    });
}

const picture = (repo: string, ref: string, file: string) =>
  `<a href="https://github.com/${repo}/blob/${ref}/${file}"><img src="https://github.com/${repo}/blob/${ref}/${file}?raw=true" width="200"></a>`;

/** The Markdown contact sheet. */
export function sheet(changes: ReadonlyArray<Change>, repo: string, days: number) {
  const title = `### Visual changes (last ${days} days)`;
  if (changes.length === 0) {
    return `${title}\n\nNo screenshot baseline changed.\n`;
  }
  const rows = changes.slice(0, maxRows).map((change) => {
    const before = change.status === 'added' ? 'new' : picture(repo, `${change.sha}^`, change.path);
    const after = change.status === 'removed' ? 'removed' : picture(repo, change.sha, change.path);
    const commit = `[${change.sha.slice(0, 7)}](https://github.com/${repo}/commit/${change.sha}) ${change.subject.replaceAll('|', '\\|')}`;
    const name =
      change.path
        .split('/')
        .pop()
        ?.replace(/\.png$/u, '') ?? change.path;
    return `| \`${name}\` | ${before} | ${after} | ${commit} |`;
  });
  const more =
    changes.length > maxRows ? `\n${changes.length - maxRows} more change(s) are not shown.\n` : '';
  const commits = new Set(changes.map((change) => change.sha)).size;
  return [
    title,
    '',
    `${changes.length} baseline(s) changed in ${commits} commit(s).`,
    '',
    '| Screenshot | Before | After | Commit |',
    '| --- | --- | --- | --- |',
    ...rows,
    more,
  ].join('\n');
}

/** The baseline changes on the first-parent history of HEAD in `root`. */
export async function changesIn(root: string, days: number) {
  const proc = Bun.spawn(
    [
      'git',
      '-C',
      root,
      'log',
      `--since=${days}.days`,
      '--first-parent',
      '--diff-merges=first-parent',
      '--no-renames',
      '--format=%x00%H%x09%s',
      '--name-status',
      '--',
      ':(glob)**/__screenshots__/*.png',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`git log failed in ${root}: ${err.trim()}`);
  }
  return parseLog(out);
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { root: { type: 'string' }, repo: { type: 'string' }, days: { type: 'string' } },
  });
  if (!values.root || !values.repo) {
    console.error(
      'Usage: bun tools/journeys/visual-digest.ts --root <checkout> --repo <owner/name> [--days 7]',
    );
    process.exit(2);
  }
  const days = Number(values.days ?? 7);
  try {
    console.log(sheet(await changesIn(values.root, days), values.repo, days));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
