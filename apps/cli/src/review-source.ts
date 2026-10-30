import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

export type ReviewFile = { mode: string; content: Buffer; hash: string };
export type ReviewSource = {
  commit: string;
  files: Map<string, ReviewFile>;
  baseline: Map<string, string>;
  roots: Array<string>;
};

function fingerprint(mode: string, content: Buffer): string {
  return createHash('sha256').update(mode).update('\0').update(content).digest('hex');
}

export function safeRelative(value: string): void {
  if (
    !value ||
    path.isAbsolute(value) ||
    value.includes('\\') ||
    value.split('/').includes('..') ||
    value.split('/').includes('.git') ||
    value.startsWith('-')
  ) {
    throw new Error(`Unsafe review-tooling path: ${value}`);
  }
}

export async function gitBytes(root: string, args: Array<string>): Promise<Buffer> {
  const child = Bun.spawn(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code) {
    throw new Error(`Cannot read committed review tooling: ${error.trim()}`);
  }
  return Buffer.from(output);
}

export async function tree(
  root: string,
  commit: string,
  prefixes: Array<string>,
): Promise<Map<string, ReviewFile>> {
  const listing = await gitBytes(root, ['ls-tree', '-rz', commit, '--', ...prefixes]);
  const records = listing.toString().split('\0').filter(Boolean);
  const files = await Promise.all(
    records.map(async (record) => {
      const [header, filename] = record.split('\t');
      safeRelative(filename);
      const [mode, type] = header.split(' ');
      if (type !== 'blob' || !['100644', '100755', '120000'].includes(mode)) {
        throw new Error(`Unsupported review-tooling entry: ${filename}`);
      }
      const content = await gitBytes(root, ['show', `${commit}:${filename}`]);
      return [filename, { mode, content, hash: fingerprint(mode, content) }] as const;
    }),
  );
  return new Map(files);
}

export async function loadReviewSource(root: string): Promise<ReviewSource> {
  const revision = await gitBytes(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const commit = revision.toString().trim();
  const configBytes = await gitBytes(root, ['show', `${commit}:review.files.yaml`]);
  const config = Bun.YAML.parse(configBytes.toString()) as {
    baseline: string;
    files: Array<string>;
    retired: Array<string>;
  };
  for (const prefix of [...config.files, ...config.retired]) {
    safeRelative(prefix);
  }
  if (config.files.some((p) => p === '.agents/skills/verify/' || p === '.claude/skills/verify')) {
    throw new Error(
      'Project-specific verify must be generated, never distributed by review install.',
    );
  }
  safeRelative(config.baseline);
  const files = await tree(root, commit, config.files);
  const baselineBytes = await gitBytes(root, ['show', `${commit}:${config.baseline}`]);
  const previous = JSON.parse(baselineBytes.toString()) as {
    schemaVersion: number;
    files: Record<string, string>;
  };
  if (previous.schemaVersion !== 1 || !previous.files || typeof previous.files !== 'object') {
    throw new Error('Unsupported review-tooling baseline.');
  }
  for (const [filename, hash] of Object.entries(previous.files)) {
    safeRelative(filename);
    if (!/^[a-f0-9]{64}$/u.test(hash)) {
      throw new Error(`Invalid baseline digest: ${filename}`);
    }
  }
  const baseline = new Map(Object.entries(previous.files));
  if (
    [...files.keys()].some(
      (p) => p.startsWith('.agents/skills/verify/') || p === '.claude/skills/verify',
    )
  ) {
    throw new Error(
      'Project-specific verify must be generated, never distributed by review install.',
    );
  }
  for (const prefix of config.files) {
    if (
      ![...files.keys()].some((file) =>
        prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix,
      )
    ) {
      throw new Error(`Review copy entry matches no committed file: ${prefix}`);
    }
  }
  return { commit, files, baseline, roots: [...config.files, ...config.retired] };
}

export async function localFile(root: string, filename: string): Promise<ReviewFile | null> {
  safeRelative(filename);
  const destination = path.join(root, filename);
  // Resolve no parent symlink, including a symlinked .review or tools directory.
  let parent = path.dirname(destination);
  while (parent !== root) {
    try {
      const parentStat = await lstat(parent);
      if (parentStat.isSymbolicLink()) {
        throw new Error(`Symlinked parent blocks installation: ${filename}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    parent = path.dirname(parent);
  }
  let stat;
  try {
    stat = await lstat(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  const regularMode = stat.mode & 0o111 ? '100755' : '100644';
  const mode = stat.isSymbolicLink() ? '120000' : regularMode;
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    throw new Error(`A directory blocks installation: ${filename}`);
  }
  const content = stat.isSymbolicLink()
    ? Buffer.from(await readlink(destination))
    : await readFile(destination);
  return { mode, content, hash: fingerprint(mode, content) };
}
