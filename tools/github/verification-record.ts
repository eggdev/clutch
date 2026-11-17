import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { Run } from '@tools/github/stack';

/**
 * The verification record of a PR: the flows whose receipts passed on the
 * tree that `pr open` pushes, and the flows that the feature map asks for and
 * that have no such receipt. It comes from the receipts of
 * tools/verification/verify.py, never from text that the agent writes. See
 * docs/contributing/delivery.md.
 */
export type VerificationRecord = {
  verified: Array<string>;
  missing: Array<string>;
  /** Each changed file is Markdown, so no flow is due. */
  docsOnly: boolean;
  /** Why the change goes out unverified, from `--unverified`. */
  reason?: string;
};

/** What the gate does with a change that has a missing flow. Set in clutch.yaml as `verification.gate`. */
const gateModes = ['off', 'observe', 'enforce'] as const;
export type GateMode = (typeof gateModes)[number];

/** The first line of the record, which tools read from the PR body. */
const recordPrefix = 'Verified: ';

const isDoc = (file: string) => /\.mdx?$/u.test(file);

/** The verify config. A project generates its own verify skill, so the file can be missing. */
const verificationFile = '.agents/skills/verify/verification.json';

type Flow = { paths?: Array<string> };
type Config = { name: string; flows: Record<string, Flow> };

/** The paths of each flow: `paths` in the verify config. A journey flow without them covers its feature folder. */
function flowPaths(root: string, config: Config): Map<string, Array<string>> {
  const map = new Map<string, Array<string>>();
  for (const [name, flow] of Object.entries(config.flows)) {
    const [journey] = new Bun.Glob(`features/*/journeys/${name}.*`).scanSync({ cwd: root });
    const feature = journey?.split('/')[1];
    map.set(name, flow.paths ?? (feature ? [`features/${feature}/**`] : []));
  }
  return map;
}

/** The flows that the map asks for: each flow with a path that matches a changed file that is not Markdown. */
function requiredFlows(files: Array<string>, map: Map<string, Array<string>>) {
  const code = files.filter((file) => !isDoc(file));
  return [...map]
    .filter(([, globs]) =>
      globs.some((glob) => code.some((file) => new Bun.Glob(glob).match(file))),
    )
    .map(([name]) => name);
}

/** The part of a receipt that the record reads. */
type Receipt = {
  action?: string;
  flow?: string;
  status?: string;
  revision?: { tree?: string | null };
};

/** Each receipt under the evidence root of the project. A receipt that does not parse is skipped. */
async function readReceipts(folder: string): Promise<Array<Receipt>> {
  const runs = await readdir(folder).catch(() => []);
  const found = await Promise.all(
    runs.map(async (run) => {
      try {
        return [JSON.parse(await readFile(path.join(folder, run, 'receipt.json'), 'utf-8'))];
      } catch {
        return [];
      }
    }),
  );
  return found.flat() as Array<Receipt>;
}

/**
 * The flows with a passing receipt that counts for `headTree`. A receipt counts
 * when its tree is the head's tree, or differs from it only in Markdown, such
 * as the changeset and the issue file that `pr open` commits.
 */
async function verifiedFlows(run: Run, receipts: Array<Receipt>, headTree: string) {
  if (!/^[0-9a-f]{40,64}$/u.test(headTree)) {
    return [];
  }
  const counts = new Map<string, boolean>();
  const matches = async (tree: string) => {
    if (tree === headTree) {
      return true;
    }
    if (!counts.has(tree)) {
      const diff = await run(['git', 'diff', '--name-only', tree, headTree]);
      counts.set(tree, diff.ok && diff.out.split('\n').every((file) => !file || isDoc(file)));
    }
    return counts.get(tree) === true;
  };
  const flows = new Set<string>();
  for (const receipt of receipts) {
    const tree = receipt.revision?.tree;
    if (
      receipt.action === 'run' &&
      receipt.status === 'passed' &&
      receipt.flow &&
      typeof tree === 'string' &&
      /^[0-9a-f]{40,64}$/u.test(tree) &&
      (await matches(tree))
    ) {
      flows.add(receipt.flow);
    }
  }
  return [...flows].toSorted();
}

/** Builds the record of the branch against `origin/<base>`. */
export async function buildRecord(
  run: Run,
  root: string,
  base: string,
  options: { evidenceRoot?: string; reason?: string } = {},
): Promise<VerificationRecord> {
  let config: Config = { name: '', flows: {} };
  try {
    config = JSON.parse(await readFile(path.join(root, verificationFile), 'utf-8')) as Config;
  } catch {
    // No verify config: no flow is due, and no receipt is read.
  }
  const [diff, head] = await Promise.all([
    run(['git', 'diff', '--name-only', `origin/${base}...HEAD`]),
    run(['git', 'rev-parse', 'HEAD^{tree}']),
  ]);
  const files = diff.out.split('\n').filter(Boolean);
  const evidenceRoot =
    options.evidenceRoot ??
    process.env.DELIVERY_EVIDENCE_ROOT ??
    path.join(homedir(), '.local/share/delivery/evidence');
  const receipts = config.name ? await readReceipts(path.join(evidenceRoot, config.name)) : [];
  const verified = await verifiedFlows(run, receipts, head.out.trim());
  const required = requiredFlows(files, flowPaths(root, config));
  return {
    verified,
    missing: required.filter((flow) => !verified.includes(flow)),
    docsOnly: files.every(isDoc),
    ...(options.reason ? { reason: options.reason.replaceAll(/\s+/gu, ' ').trim() } : {}),
  };
}

/** The one line that holds the record, such as `Verified: notes-sync, installer`. */
export function renderRecord(record: VerificationRecord) {
  const { verified, missing, docsOnly, reason } = record;
  let line = recordPrefix + (verified.join(', ') || 'none');
  if (verified.length === 0 && missing.length === 0) {
    line += docsOnly ? ' (docs only)' : ' (no flow covers these files)';
  }
  if (missing.length > 0) {
    line += `; missing: ${missing.join(', ')}`;
  }
  return reason ? `${line}; unverified because: ${reason}` : line;
}

/**
 * Writes the record as the first line of the "Verification" section, and
 * removes an older record, so a second `pr open` leaves one record.
 */
export function stampBody(body: string, line: string) {
  const lines = body.split('\n');
  const heading = lines.findIndex((text) => text.trim() === '## Verification');
  if (heading === -1) {
    return `${body.trimEnd()}\n\n## Verification\n\n${line}\n`;
  }
  const next = lines.findIndex((text, index) => index > heading && text.startsWith('## '));
  const end = next === -1 ? lines.length : next;
  const section = lines.slice(heading + 1, end).filter((text) => !text.startsWith(recordPrefix));
  while (section[0]?.trim() === '') {
    section.shift();
  }
  return [...lines.slice(0, heading + 1), '', line, '', ...section, ...lines.slice(end)].join('\n');
}

/**
 * What the gate does with a record. A change that is not docs only and has a
 * missing flow is one that the gate blocks. `observe` prints a notice,
 * `enforce` refuses it unless the record has a reason, and `off` does nothing.
 */
export function gateDecision(mode: GateMode, record: VerificationRecord) {
  if (mode === 'off' || record.docsOnly || record.missing.length === 0) {
    return {};
  }
  const flows = record.missing.join(', ');
  const run = `Run each with: python3 tools/verification/verify.py --config ${verificationFile} run <flow>.`;
  if (mode === 'observe') {
    return {
      notice: `The verification gate would block this PR: no passing receipt on this tree for ${flows}. ${run} The gate is in observe mode, so the PR goes on.`,
    };
  }
  if (record.reason) {
    return {};
  }
  return {
    refuse: `The verification gate blocks this PR: no passing receipt on this tree for ${flows}. ${run} Then run pr open again. To open it unverified, pass --unverified "<reason>".`,
  };
}

/** `verification.gate` in clutch.yaml. observe is the default. */
async function gateMode(root: string): Promise<GateMode> {
  const text = await readFile(path.join(root, 'clutch.yaml'), 'utf-8').catch(() => '');
  const { verification } = (Bun.YAML.parse(text) ?? {}) as { verification?: { gate?: unknown } };
  const gate = verification?.gate;
  return gateModes.find((mode) => mode === gate) ?? 'observe';
}

/** The options of `bun run pr open`. */
export type OpenOptions = Partial<
  Record<'title' | 'body-file' | 'base' | 'unverified', string> & { force: boolean }
>;

/**
 * Writes the record into the body file, and applies the gate of clutch.yaml.
 * A missing body file is left for gh to report.
 */
export async function recordVerification(
  run: Run,
  root: string,
  options: { base: string; bodyFile: string; reason?: string },
) {
  const record = await buildRecord(run, root, options.base, { reason: options.reason });
  const decision = gateDecision(await gateMode(root), record);
  if (decision.refuse) {
    throw new Error(decision.refuse);
  }
  if (decision.notice) {
    console.log(decision.notice);
  }
  const file = Bun.file(path.resolve(root, options.bodyFile));
  if (await file.exists()) {
    await Bun.write(file, stampBody(await file.text(), renderRecord(record)));
  }
}
