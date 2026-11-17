import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

/**
 * The verification record of a PR: the flows that the feature map asks for,
 * and those of them with a passing receipt that counts for the head. It comes
 * from the receipts of tools/verification/verify.py, never from text that the
 * agent writes. See .agents/skills/deliver/references/pull-requests.md.
 */
export type VerificationRecord = {
  /** The flows that the map at the base or at the head names for a changed file that is not Markdown. */
  due: Array<string>;
  /** The due flows with a receipt that counts. */
  verified: Array<string>;
  /** Each changed file is Markdown, so no flow is due. */
  docsOnly: boolean;
  /** Why the change goes out with a missing flow, from `--unverified`. */
  reason?: string;
};

/** What the gate does with a change that has a missing flow, from the weakest to the strictest. */
const gateModes = ['off', 'observe', 'enforce'] as const;
export type GateMode = (typeof gateModes)[number];

/** Each line of a PR body that starts with this is a record. */
const recordPrefix = 'Verified: ';
/** The start of each record of a PR that is not fully verified. The query in the docs searches for it. */
export const incompletePrefix = `${recordPrefix}incomplete (`;

const isDoc = (file: string) => /\.mdx?$/u.test(file);
const treeId = /^[0-9a-f]{40,64}$/u;

/** The verify config. A project generates its own verify skill, so the file can be missing. */
const verificationFile = '.agents/skills/verify/verification.json';

type Config = { name?: string; flows?: Record<string, { paths?: Array<string> }> };

/** A file at a commit, or '' when the commit has no such file. */
async function show(run: Run, ref: string, file: string) {
  const shown = await run(['git', 'show', `${ref}:${file}`]);
  return shown.ok ? shown.out : '';
}

async function readConfig(run: Run, ref: string): Promise<Config> {
  const text = await show(run, ref, verificationFile);
  return text.trim() ? (JSON.parse(text) as Config) : {};
}

/** The paths of each flow: `paths` in the verify config. A journey flow without them covers its feature folder. */
function flowPaths(root: string, config: Config, into: Map<string, Array<string>>) {
  for (const [name, flow] of Object.entries(config.flows ?? {})) {
    const [journey] = new Bun.Glob(`features/*/journeys/${name}.*`).scanSync({ cwd: root });
    const feature = journey?.split('/')[1];
    const globs = flow.paths ?? (feature ? [`features/${feature}/**`] : []);
    into.set(name, [...(into.get(name) ?? []), ...globs]);
  }
}

/** Whether a glob of a flow matches one of the files. A Markdown file never matches. */
const covers = (globs: Array<string>, files: Array<string>) =>
  files.some((file) => !isDoc(file) && globs.some((glob) => new Bun.Glob(glob).match(file)));

/** The files that the branch changes against `origin/<base>`. Throws when Git cannot tell. */
async function changedFiles(run: Run, base: string) {
  const ref = `origin/${base}`;
  const found = await run(['git', 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (!found.ok) {
    throw new Error(
      `Cannot find ${ref}, so the verification record cannot know which files changed. Run git fetch origin ${base}, or pass the right --base.`,
    );
  }
  const diff = await run(['git', 'diff', '--name-only', `${ref}...HEAD`]);
  if (!diff.ok) {
    throw new Error(`git diff against ${ref} failed, so no record is possible. ${diff.err.trim()}`);
  }
  return diff.out.split('\n').filter(Boolean);
}

/** The part of a receipt that the record reads. */
type Receipt = {
  action?: string;
  flow?: string;
  status?: string;
  stale?: boolean;
  revision?: { tree?: string | null };
  revisionAfter?: { tree?: string | null };
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
 * The due flows with a passing receipt that counts. It counts when its flow
 * covers no file that differs between its tree and the head's tree, and its
 * tree is in the repository and did not change during the run.
 */
async function verifiedFlows(run: Run, receipts: Array<Receipt>, due: Map<string, Array<string>>) {
  const parsed = await run(['git', 'rev-parse', 'HEAD^{tree}']);
  const head = parsed.out.trim();
  const flows = new Set<string>();
  for (const { flow = '', ...receipt } of treeId.test(head) ? receipts : []) {
    const tree = String(receipt.revision?.tree);
    const globs = due.get(flow);
    if (
      receipt.action === 'run' &&
      receipt.status === 'passed' &&
      receipt.stale !== true &&
      globs &&
      treeId.test(tree) &&
      (receipt.revisionAfter === undefined || receipt.revisionAfter.tree === tree)
    ) {
      const diff = await run(['git', 'diff', '--name-only', tree, head]);
      if (diff.ok && !covers(globs, diff.out.split('\n'))) {
        flows.add(flow);
      }
    }
  }
  return [...flows].toSorted();
}

/**
 * Builds the record of the branch against `origin/<base>`. A flow is due when
 * the map at the base or the map at the head names it for a changed file. So
 * a PR can add coverage, and cannot remove it for itself.
 */
export async function buildRecord(
  run: Run,
  root: string,
  base: string,
  options: { evidenceRoot?: string; reason?: string } = {},
): Promise<VerificationRecord> {
  const files = await changedFiles(run, base);
  const configs = await Promise.all([readConfig(run, `origin/${base}`), readConfig(run, 'HEAD')]);
  const map = new Map<string, Array<string>>();
  for (const config of configs) {
    flowPaths(root, config, map);
  }
  const due = new Map([...map].filter(([, globs]) => covers(globs, files)));
  const name = configs[1].name || configs[0].name;
  const evidenceRoot =
    options.evidenceRoot ??
    process.env.DELIVERY_EVIDENCE_ROOT ??
    path.join(homedir(), '.local/share/delivery/evidence');
  const receipts = name && due.size > 0 ? await readReceipts(path.join(evidenceRoot, name)) : [];
  const verified = await verifiedFlows(run, receipts, due);
  const reason = options.reason?.replaceAll(/\s+/gu, ' ').trim();
  return {
    due: [...due.keys()].toSorted(),
    verified,
    docsOnly: files.length > 0 && files.every(isDoc),
    ...(reason && verified.length < due.size ? { reason } : {}),
  };
}

const missingOf = (record: VerificationRecord) =>
  record.due.filter((flow) => !record.verified.includes(flow));

/** The one line that holds the record. The docs list each form. */
export function renderRecord(record: VerificationRecord) {
  const { due, verified, docsOnly, reason } = record;
  const missing = missingOf(record);
  if (docsOnly) {
    return `${recordPrefix}docs-only`;
  }
  if (due.length > 0 && missing.length === 0) {
    return recordPrefix + verified.join(', ');
  }
  const parts =
    due.length === 0
      ? ['no flow covers these files']
      : [
          ...(verified.length > 0 ? [`passed: ${verified.join(', ')}`] : []),
          `missing: ${missing.join(', ')}`,
        ];
  return `${incompletePrefix}${[...parts, ...(reason ? [`unverified because: ${reason}`] : [])].join('; ')})`;
}

/**
 * Writes the record as the first line of the "Verification" section. It
 * removes each other line that starts like a record, so a second run leaves
 * one record, and a line that the agent wrote cannot stand as one.
 */
export function stampBody(body: string, line: string) {
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((text) => !text.startsWith(recordPrefix));
  const heading = lines.findIndex((text) => text.trim() === '## Verification');
  if (heading === -1) {
    return `${lines.join('\n').trimEnd()}\n\n## Verification\n\n${line}\n`.replaceAll('\n', eol);
  }
  const rest = lines.slice(heading + 1);
  while (rest[0]?.trim() === '') {
    rest.shift();
  }
  return [...lines.slice(0, heading + 1), '', line, '', ...rest].join(eol);
}

/**
 * What the gate does with a record that has a missing flow. `observe` prints
 * a notice, `enforce` refuses it unless the record has a reason, and `off`
 * does nothing.
 */
export function gateDecision(mode: GateMode, record: VerificationRecord) {
  const missing = missingOf(record);
  if (mode === 'off' || missing.length === 0) {
    return {};
  }
  const flows = missing.join(', ');
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

/** `verification.gate` in clutch.yaml at a commit. observe is the default. A value that is not a mode throws. */
async function gateAt(run: Run, ref: string): Promise<GateMode> {
  const parsed = Bun.YAML.parse(await show(run, ref, 'clutch.yaml')) as {
    verification?: { gate?: unknown };
  } | null;
  const gate = parsed?.verification?.gate ?? 'observe';
  const mode = gateModes.find((each) => each === gate);
  if (!mode) {
    throw new Error(
      `verification.gate in clutch.yaml is ${JSON.stringify(gate)}. Use ${gateModes.join(', ')}.`,
    );
  }
  return mode;
}

/**
 * The gate for the PR: the stricter of the base and the head, so a PR cannot
 * weaken it for itself. A bad value at the base counts as enforce, so a PR
 * can still fix it.
 */
async function gateMode(run: Run, base: string) {
  const head = await gateAt(run, 'HEAD');
  const atBase = await gateAt(run, `origin/${base}`).catch(() => 'enforce' as const);
  return gateModes[Math.max(gateModes.indexOf(head), gateModes.indexOf(atBase))];
}

/** The options of `bun run pr open`. */
export type OpenOptions = Partial<
  Record<'title' | 'body-file' | 'base' | 'unverified', string> & { force: boolean }
>;

/**
 * Writes the record into the body file. With `gate`, it first applies the
 * gate of clutch.yaml. A missing body file is left for gh to report.
 */
export async function recordVerification(
  run: Run,
  root: string,
  options: { base: string; bodyFile: string; reason?: string; gate: boolean },
) {
  const record = await buildRecord(run, root, options.base, { reason: options.reason });
  if (options.gate) {
    const decision = gateDecision(await gateMode(run, options.base), record);
    if (decision.refuse) {
      throw new Error(decision.refuse);
    }
    if (decision.notice) {
      console.log(decision.notice);
    }
  }
  const file = Bun.file(path.resolve(root, options.bodyFile));
  if (await file.exists()) {
    await Bun.write(file, stampBody(await file.text(), renderRecord(record)));
  }
}

/** `bun run pr body`: writes the record of the PR's branch into the body file, with no gate. */
export async function recordBody(
  run: Run,
  root: string,
  options: { number: string; bodyFile: string; reason?: string },
) {
  const view = ['gh', 'pr', 'view', options.number, '--json', 'baseRefName,headRefName'];
  const pr = JSON.parse(await must(run, view)) as Record<string, string>;
  // The record describes the local branch, so it must be the PR's head.
  if (pr.headRefName !== (await must(run, ['git', 'branch', '--show-current']))) {
    throw new Error(
      `Switch to ${pr.headRefName}, the branch of PR ${options.number}, to set its body.`,
    );
  }
  await recordVerification(run, root, { ...options, base: pr.baseRefName, gate: false });
}
