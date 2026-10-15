import { existsSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { blankFences, listDocs, readDoc } from '@tools/docs-files';

/**
 * A relative Markdown link, or an inline code path that starts at a repository
 * root folder, must name a file that exists. Fenced examples are skipped. A
 * code path is checked only when its parent folder exists, so an example of a
 * folder that a doc proposes is not an error. A code path right after "no",
 * "not" or "without" states an absence and is skipped.
 */
const roots = ['apps/', 'packages/', 'docs/', 'tools/', '.agents/', '.github/'];
const ignored = /(?:^|\/)(?:\.wrangler\/|\.env(?:\.(?!example$)[^/]+)?$|\.dev\.vars$)|NNNN|\.\.\./;

export type Reference = { file: string; line: number; path: string; kind: 'code' | 'link' };

export function collectReferences(file: string, content: string): Reference[] {
  const references: Reference[] = [];
  const resolve = (token: string, bare: boolean) => {
    const value = token.replace(/[?#].*$/, '').replace(/:\d+(?::\d+)?$/, '');
    if (!/\.[A-Za-z0-9]{1,10}$/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
    const path =
      value.startsWith('./') || value.startsWith('../') || (bare && !value.startsWith('/'))
        ? normalize(join(dirname(file), value))
        : roots.some((root) => value.startsWith(root))
          ? normalize(value)
          : null;
    return path && !path.startsWith('../') && !path.startsWith('/') ? path : null;
  };
  for (const [index, line] of blankFences(content).split('\n').entries()) {
    for (const match of line.matchAll(/`([^`\s]+)`/g)) {
      if (
        /\b(?:no|not|without|missing)\s+$/i.test(line.slice(0, match.index)) ||
        !match[1].includes('/')
      )
        continue;
      if (/[*?<>$|()[\]{}!]/.test(match[1])) continue;
      const path = resolve(match[1], false);
      if (path) references.push({ file, line: index + 1, path, kind: 'code' });
    }
    for (const match of line
      .replace(/`[^`]*`/g, (span) => ' '.repeat(span.length))
      .matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const path = resolve(match[1], true);
      if (path) references.push({ file, line: index + 1, path, kind: 'link' });
    }
  }
  return references;
}

export async function checkDocsFileRefs(root: string): Promise<string[]> {
  const errors: string[] = [];
  const is = (path: string, kind: 'file' | 'directory') =>
    existsSync(join(root, path)) &&
    (kind === 'file'
      ? statSync(join(root, path)).isFile()
      : statSync(join(root, path)).isDirectory());
  for (const file of await listDocs(root))
    for (const reference of collectReferences(file, await readDoc(root, file))) {
      if (ignored.test(reference.path) || is(reference.path, 'file')) continue;
      const parent = dirname(reference.path);
      if (reference.kind === 'code' && parent !== '.' && !is(parent, 'directory')) continue;
      errors.push(`${reference.file}:${reference.line}: \`${reference.path}\` does not exist.`);
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
  } else console.log('Docs file references point at files that exist.');
}
