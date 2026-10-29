import { existsSync } from 'node:fs';
import path from 'node:path';

import { listDocs, readDoc, unitsOf } from '@tools/docs-files';

/**
 * A doc that says a check, lint rule, test or hook enforces something must
 * name one that exists. An agent trusts such a sentence and stops looking, so
 * a claim with nothing behind it is worse than no claim. Decision records are
 * point-in-time, and kickoff slots are HTML comments, so both are skipped.
 */
const checked = (file: string) =>
  file.startsWith('docs/') && !file.startsWith('docs/contributing/decisions/');

const verb = String.raw`(?:rejects?|fails?|blocks?|catches|refuses?|flags)`;
/** `check-x rejects`: a named subject. The code span before the verb must exist. */
const namedClaim = new RegExp(String.raw`\uE000(\d+)\uE000\s+(?:also\s+)?${verb}\b`, 'giu');
/** A claim whose subject is a kind of enforcer, not a name: "a check rejects", "fails CI". */
const unnamedClaims = [
  new RegExp(
    String.raw`\b(?:a|an|the|each|one)\s+(?:[\w-]+\s+){0,2}(?:checks?|tests?|lint rules?|hooks?|guards?|CI jobs?)\s+(?:that\s+)?(?:[\w\uE000-]+\s+){0,5}?${verb}\b`,
    'iu',
  ),
  /\b(?:rejects?|fails?|blocks?)\s+(?:CI|the merge|the build)\b/iu,
  new RegExp(String.raw`\b(?:CI|an agent hook|the hook)\s+${verb}\b`, 'iu'),
];

/** The names a doc may give an enforcer: targets, lint rules and hook scripts. */
export type Enforcers = { readonly names: ReadonlySet<string>; readonly root: string };

const quotedKeys = (text: string) =>
  [...text.matchAll(/['"]([@a-z0-9][\w@/-]*)['"]\s*:/gu)].map((match) => match[1]);

async function readText(file: string): Promise<string> {
  const handle = Bun.file(file);
  return (await handle.exists()) ? handle.text() : '';
}

/** Every check target, lint rule id and agent hook in the repository under `root`. */
export async function enforcersOf(root: string): Promise<Enforcers> {
  const names = new Set<string>();
  const manifests = ['package.json'];
  for await (const file of new Bun.Glob('{apps,features,packages,tools}/*/package.json').scan({
    cwd: root,
  })) {
    manifests.push(file);
  }
  for (const file of manifests) {
    const manifest = await Bun.file(path.join(root, file)).json();
    for (const target of Object.keys(manifest.nx?.targets ?? {})) {
      names.add(target);
    }
  }
  for (const config of ['oxlint.config.ts', 'stylelint.config.ts']) {
    for (const key of quotedKeys(await readText(path.join(root, config)))) {
      names.add(key);
      names.add(key.split('/').at(-1) ?? key);
    }
  }
  for await (const file of new Bun.Glob('node_modules/ultracite/config/oxlint/*/index.mjs').scan({
    cwd: root,
  })) {
    for (const key of quotedKeys(await readText(path.join(root, file)))) {
      names.add(key);
    }
  }
  for await (const file of new Bun.Glob('{.agents/hooks/*.ts,.githooks/*}').scan({
    cwd: root,
    dot: true,
  })) {
    names.add(path.basename(file, '.ts'));
  }
  return { names, root };
}

/** Whether a code span or link target names an enforcer that exists. */
function exists(enforcers: Enforcers, reference: string): boolean {
  const name = reference.replace(/^\.\.?\//u, '').replace(/#.*$/u, '');
  if (enforcers.names.has(name)) {
    return true;
  }
  const looksLikeFile = /\/|\.(?:[cm]?[jt]sx?|json|ya?ml)$/u.test(name);
  return looksLikeFile && existsSync(path.join(enforcers.root, name.replace(/^(?:\.\.\/)+/u, '')));
}

/** Whether a reference is shaped like an enforcer name, so a missing one is a false claim. */
const enforcerShaped = (reference: string) =>
  /^(?:check-[a-z-]+|[a-z-]+\/[a-z-]+|.*\.test\.tsx?|tools\/check-[a-z-]+\.ts|\.agents\/hooks\/.+)$/u.test(
    reference,
  );

export type Claim = { file: string; line: number; problem: string };

/** The claims in one page that name nothing, or name an enforcer that does not exist. */
export function findClaims(file: string, content: string, enforcers: Enforcers): Array<Claim> {
  if (!checked(file)) {
    return [];
  }
  const claims: Array<Claim> = [];
  for (const unit of unitsOf(content)) {
    const references: Array<string> = [];
    const masked = unit.text
      .replaceAll(/`([^`]+)`/gu, (_, code: string) => `\uE000${references.push(code) - 1}\uE000`)
      .replaceAll(/\[[^\]]*\]\(([^)\s]+)\)/gu, (_, target: string) => {
        references.push(target);
        return ` \uE000${references.length - 1}\uE000 `;
      });
    // The plain words for the typecheck, lint and validate targets also name an enforcer.
    const backed =
      references.some((reference) => exists(enforcers, reference)) ||
      /\b(?:typecheck|type system|TypeScript|lint|validate)\b/u.test(masked);
    for (const sentence of masked.split(/(?<=[.!?])\s+/u)) {
      for (const match of sentence.matchAll(namedClaim)) {
        const name = references[Number(match[1])] ?? '';
        if (enforcerShaped(name) && !exists(enforcers, name)) {
          claims.push({
            file,
            line: unit.line,
            problem: `\`${name}\` is not a check target, lint rule, test file or agent hook.`,
          });
        }
      }
      if (!backed && unnamedClaims.some((pattern) => pattern.test(sentence))) {
        const quoted = sentence.replaceAll(
          /\uE000(\d+)\uE000/gu,
          (_, index: string) => `\`${references[Number(index)]}\``,
        );
        claims.push({
          file,
          line: unit.line,
          problem: `"${quoted.trim().slice(0, 90)}" claims enforcement but names no check, lint rule, test or hook that exists.`,
        });
      }
    }
  }
  return claims;
}

export async function checkDocsClaims(root: string): Promise<Array<string>> {
  const enforcers = await enforcersOf(root);
  const problems: Array<string> = [];
  for (const file of await listDocs(root)) {
    for (const claim of findClaims(file, await readDoc(root, file), enforcers)) {
      problems.push(`${claim.file}:${claim.line}: ${claim.problem}`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const problems = await checkDocsClaims(process.cwd());
  if (problems.length) {
    console.error(
      [
        `Docs claims check failed (${problems.length}).`,
        'Name the check target, lint rule, test file or agent hook that enforces each rule. If none exists, state the rule and say that no check covers it. See docs/contributing/documentation.md.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log(
      'Each enforcement claim in docs/ names a check, lint rule, test or hook that exists.',
    );
  }
}
