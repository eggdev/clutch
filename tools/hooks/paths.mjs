import { relative } from 'node:path';

/**
 * A docs-only change cannot break a build, a type or a test, so the hooks skip
 * the slow checks for it. Docs-only means Markdown anywhere, any file under
 * docs/, or a license text.
 */
export const isDocsOnly = (path) =>
  path.startsWith('docs/') ||
  /\.(?:md|mdx|mdc)$/.test(path) ||
  /(?:^|\/)(?:LICENSE|LICENCE|COPYING|NOTICE)(?:\.txt)?$/.test(path);

const lintable = /\.[cm]?[jt]sx?$/;
const formattable = /\.(?:[cm]?[jt]sx?|jsonc?|md|ya?ml|css)$/;
const quote = (paths) => paths.map((path) => JSON.stringify(path)).join(' ');

/**
 * The pre-commit commands for the staged files, in order. Lint fixes come
 * before formatting, because a lint fix can leave code unformatted. The
 * install check and the typecheck run only when a staged file is not docs.
 * Lint-staged hides unstaged changes while these run, so the typecheck reads
 * the staged tree.
 */
export function stagedCommands(files, root = process.cwd()) {
  const paths = files.map((file) => relative(root, file));
  const commands = [];
  const lint = files.filter((file) => lintable.test(file));
  const format = files.filter((file) => formattable.test(file));
  if (lint.length) commands.push(`oxlint --fix ${quote(lint)}`);
  if (format.length) commands.push(`oxfmt --no-error-on-unmatched-pattern ${quote(format)}`);
  if (!paths.every(isDocsOnly))
    commands.push('bun install --frozen-lockfile', 'nx run-many -t typecheck');
  return commands;
}

/** Lint-staged reads this config through `--config` in .githooks/pre-commit. */
export default (files) => stagedCommands(files);
