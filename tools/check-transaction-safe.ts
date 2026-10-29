import path from 'node:path';

import { isTestFile, readRegistry, registryFile } from '@tools/lint/import-policy.mjs';

/**
 * A server change may use only a transaction-safe service. The type in
 * packages/sync/service/transaction-safe.ts reads a mark in the service shape,
 * so any service could mark itself. This check makes the registry the one
 * place that grants the mark: a service shape with the mark must be listed
 * under `transactionSafe` of the package that owns it. The registry is a
 * guardrail file, so a person reviews each grant. See
 * docs/contributing/architecture/server.md#services-in-a-server-change.
 */
const sources = '{apps,features,packages}/**/*.{ts,tsx}';
const markFile = 'packages/sync/service/transaction-safe.ts';
const mark = '[transactionSafe]';
const service =
  /class\s+\w+\s+extends\s+Context\.Service<([\s\S]*?)>\(\)\(\s*(['"])([^'"]+)\2\s*\)/gu;

type Primitive = { id?: string; code?: Array<string>; transactionSafe?: Array<string> };

/** The package primitive that owns a file: the longest code root that holds it. */
function ownerOf(primitives: Array<Primitive>, file: string): Primitive | undefined {
  return primitives
    .flatMap((primitive) => (primitive.code ?? []).map((root) => ({ primitive, root })))
    .filter(({ root }) => file.startsWith(root))
    .toSorted((a, b) => b.root.length - a.root.length)[0]?.primitive;
}

export async function checkTransactionSafe(root: string): Promise<Array<string>> {
  const primitives: Array<Primitive> = readRegistry(root)?.primitives ?? [];
  const problems: Array<string> = [];
  const declared = new Set<string>();
  for await (const file of new Bun.Glob(sources).scan({ cwd: root })) {
    const skip = /(?:^|\/)(?:node_modules|out-tsc|dist)\//u.test(file) || isTestFile(file);
    if (skip || file === markFile) {
      continue;
    }
    const text = await Bun.file(path.join(root, file)).text();
    if (!text.includes(mark)) {
      continue;
    }
    const granted = ownerOf(primitives, file)?.transactionSafe ?? [];
    const marked = [...text.matchAll(service)].filter((match) => match[1].includes(mark));
    if (!marked.length) {
      problems.push(
        `${file}: it uses the transaction-safe mark outside a Context.Service shape. Put the mark in the service shape, and list the service key in ${registryFile}.`,
      );
    }
    for (const match of marked) {
      const key = match[3];
      declared.add(key);
      if (!granted.includes(key)) {
        problems.push(
          `${file}: \`${key}\` marks itself transaction-safe, but ${registryFile} does not list it under \`transactionSafe\` of its package. Add it there for a person to review, or remove the mark and call the service from a job.`,
        );
      }
    }
  }
  for (const primitive of primitives) {
    for (const key of (primitive.transactionSafe ?? []).filter((item) => !declared.has(item))) {
      problems.push(
        `${registryFile}: primitive \`${primitive.id}\` lists \`${key}\` as transaction-safe, but no service shape with that key has the mark. Delete the entry.`,
      );
    }
  }
  return problems.toSorted();
}

if (import.meta.main) {
  const problems = await checkTransactionSafe(process.cwd());
  if (problems.length) {
    console.error(
      [
        `Transaction-safe check failed (${problems.length}).`,
        'Only the registry grants the transaction-safe mark, so a person reviews each grant.',
        'See docs/contributing/architecture/server.md#services-in-a-server-change.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Each transaction-safe service is listed in the registry.');
  }
}
