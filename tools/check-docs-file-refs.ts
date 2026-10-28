import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { blankFences, listDocs, readDoc } from '@tools/docs-files';

/**
 * A relative Markdown link, or an inline code path that starts at a repository
 * root folder, must name a file that exists. Fenced examples are skipped. A
 * code path is checked only when its parent folder exists, so an example of a
 * folder that a doc proposes is not an error. A code path right after "no",
 * "not" or "without" states an absence and is skipped.
 */
const roots = ['apps/', 'features/', 'packages/', 'docs/', 'tools/', '.agents/', '.github/'];
const ignored = /(?:^|\/)(?:\.wrangler\/|\.env(?:\.(?!example$)[^/]+)?$|\.dev\.vars$)|NNNN|\.\.\./u;

export type Reference = { file: string; line: number; path: string; kind: 'code' | 'link' };

export function collectReferences(file: string, content: string): Array<Reference> {
  const references: Array<Reference> = [];
  const resolve = (token: string, bare: boolean) => {
    const value = token.replace(/[?#].*$/u, '').replace(/:\d+(?::\d+)?$/u, '');
    if (!/\.[A-Za-z0-9]{1,10}$/u.test(value) || /^[a-z][a-z0-9+.-]*:/iu.test(value)) {
      return null;
    }
    let target: string | null = null;
    if (value.startsWith('./') || value.startsWith('../') || (bare && !value.startsWith('/'))) {
      target = path.normalize(path.join(path.dirname(file), value));
    } else if (roots.some((root) => value.startsWith(root))) {
      target = path.normalize(value);
    }
    return target && !target.startsWith('../') && !target.startsWith('/') ? target : null;
  };
  for (const [index, line] of blankFences(content).split('\n').entries()) {
    for (const match of line.matchAll(/`([^`\s]+)`/gu)) {
      if (
        /\b(?:no|not|without|missing)\s+$/iu.test(line.slice(0, match.index)) ||
        !match[1].includes('/')
      ) {
        continue;
      }
      if (/[*?<>$|()[\]{}!]/u.test(match[1])) {
        continue;
      }
      const target = resolve(match[1], false);
      if (target) {
        references.push({ file, line: index + 1, path: target, kind: 'code' });
      }
    }
    for (const match of line
      .replaceAll(/`[^`]*`/gu, (span) => ' '.repeat(span.length))
      .matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/gu)) {
      const target = resolve(match[1], true);
      if (target) {
        references.push({ file, line: index + 1, path: target, kind: 'link' });
      }
    }
  }
  return references;
}

export async function checkDocsFileRefs(root: string): Promise<Array<string>> {
  const errors: Array<string> = [];
  const is = (target: string, kind: 'file' | 'directory') =>
    existsSync(path.join(root, target)) &&
    (kind === 'file'
      ? statSync(path.join(root, target)).isFile()
      : statSync(path.join(root, target)).isDirectory());
  for (const file of await listDocs(root)) {
    for (const reference of collectReferences(file, await readDoc(root, file))) {
      if (ignored.test(reference.path) || is(reference.path, 'file')) {
        continue;
      }
      const parent = path.dirname(reference.path);
      if (reference.kind === 'code' && parent !== '.' && !is(parent, 'directory')) {
        continue;
      }
      errors.push(`${reference.file}:${reference.line}: \`${reference.path}\` does not exist.`);
    }
  }
  return errors;
}

if (import.meta.main) {
  const errors = await checkDocsFileRefs(process.cwd());
  if (errors.length) {
    console.error(
      [
        `Docs file reference check failed (${errors.length}).`,
        'Fix the path, or remove the reference to a file that is gone.',
        '',
        ...errors,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Docs file references point at files that exist.');
  }
}
