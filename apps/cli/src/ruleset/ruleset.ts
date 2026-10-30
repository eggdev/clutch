import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Runs `gh` with these arguments. */
export type Gh = (args: Array<string>) => Promise<{ ok: boolean; out: string; err: string }>;

const rulesetDir = '.github/rulesets';

type BypassActor = { actor_type: string; actor_id: unknown; bypass_mode: string };
type Ruleset = { name: string; bypass_actors?: Array<BypassActor>; [key: string]: unknown };

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An `actor_id` such as `vars.CLUTCH_APP_ID` names a repository variable that holds the id. */
const variableRef = /^vars\.([A-Z][A-Z0-9_]*)$/u;

/** Each ruleset file in `root`, by file name. A repository without the folder has none. */
async function readRulesets(root: string) {
  const folder = path.join(root, rulesetDir);
  const names = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return [] as Array<string>;
    }
    throw error;
  });
  const files = names.filter((name) => name.endsWith('.json')).toSorted();
  return Promise.all(
    files.map(async (name) => ({
      file: `${rulesetDir}/${name}`,
      ruleset: JSON.parse(await readFile(path.join(folder, name), 'utf-8')) as Ruleset,
    })),
  );
}

async function ghJson(gh: Gh, args: Array<string>) {
  const result = await gh(['api', ...args]);
  if (!result.ok) {
    throw new Error(`gh api ${args.join(' ')}: ${result.err.trim() || 'failed'}`);
  }
  return JSON.parse(result.out || 'null') as unknown;
}

/** A repository variable's value, or null when the repository has no such variable. */
async function variable(gh: Gh, repo: string, name: string) {
  const result = await gh(['api', `repos/${repo}/actions/variables/${name}`]);
  if (result.ok) {
    return (JSON.parse(result.out) as { value: string }).value;
  }
  if (!/HTTP 404/u.test(result.err)) {
    throw new Error(`gh api repos/${repo}/actions/variables/${name}: ${result.err.trim()}`);
  }
  return null;
}

/**
 * The ruleset as GitHub takes it for `repo`. A bypass actor whose id names a
 * repository variable gets that variable's value, so one file fits every
 * project. When the variable is not set, the actor is dropped with a note.
 */
export async function resolveRuleset(ruleset: Ruleset, repo: string, gh: Gh) {
  const notes: Array<string> = [];
  const actors: Array<BypassActor> = [];
  for (const actor of ruleset.bypass_actors ?? []) {
    const ref = typeof actor.actor_id === 'string' ? variableRef.exec(actor.actor_id) : null;
    if (!ref) {
      actors.push(actor);
      continue;
    }
    const value = await variable(gh, repo, ref[1]);
    if (value && /^\d+$/u.test(value)) {
      actors.push({ ...actor, actor_id: Number(value) });
    } else {
      notes.push(
        `${ref[1]} is not set, so the ruleset leaves out the ${actor.actor_type} bypass actor. See docs/contributing/setup/releases.md#the-release-bot.`,
      );
    }
  }
  return { ruleset: { ...ruleset, bypass_actors: actors }, notes };
}

/** A key that names an array item, so two lists compare item by item, in any order. */
function itemKey(item: unknown) {
  if (!isMap(item)) {
    return JSON.stringify(item);
  }
  for (const key of ['type', 'context', 'actor_type']) {
    if (typeof item[key] === 'string') {
      return key === 'actor_type'
        ? `${item.actor_type}:${String(item.actor_id)}`
        : String(item[key]);
    }
  }
  return JSON.stringify(item);
}

/**
 * Where GitHub's ruleset `have` differs from the file's `want`. Only the keys
 * that the file names count, because GitHub adds defaults. A list must hold
 * the same items, in any order.
 */
export function rulesetDifferences(want: unknown, have: unknown, at = ''): Array<string> {
  if (Array.isArray(want)) {
    if (!Array.isArray(have)) {
      return [`${at}: expected a list`];
    }
    const haveByKey = new Map(have.map((item) => [itemKey(item), item]));
    const wantKeys = new Set(want.map(itemKey));
    const found = want.flatMap((item) => {
      const key = itemKey(item);
      return haveByKey.has(key)
        ? rulesetDifferences(item, haveByKey.get(key) ?? null, `${at}[${key}]`)
        : [`${at}: missing ${key}`];
    });
    const extra = [...haveByKey.keys()]
      .filter((key) => !wantKeys.has(key))
      .map((key) => `${at}: extra ${key}`);
    return [...found, ...extra];
  }
  if (isMap(want)) {
    if (!isMap(have)) {
      return [`${at}: expected a map`];
    }
    return Object.entries(want).flatMap(([key, value]) =>
      rulesetDifferences(value, have[key] ?? null, at ? `${at}.${key}` : key),
    );
  }
  return want === have ? [] : [`${at}: ${JSON.stringify(have)}, want ${JSON.stringify(want)}`];
}

/** The repository's ruleset with this name, in full, or nothing. */
async function liveRuleset(gh: Gh, repo: string, name: string) {
  const list = (await ghJson(gh, [`repos/${repo}/rulesets?per_page=100`])) as Array<{
    id: number;
    name: string;
  }>;
  const match = list.find((item) => item.name === name);
  return match
    ? { id: match.id, ruleset: await ghJson(gh, [`repos/${repo}/rulesets/${match.id}`]) }
    : undefined;
}

export type RulesetState = {
  file: string;
  name: string;
  /** missing: GitHub has no ruleset with this name. differs: it has one that differs. */
  state: 'matches' | 'differs' | 'missing';
  differences: Array<string>;
  notes: Array<string>;
};

/** How each ruleset file in `root` compares with GitHub. Only GET requests. */
export async function compareRulesets(root: string, repo: string, gh: Gh) {
  const states: Array<RulesetState> = [];
  for (const { file, ruleset } of await readRulesets(root)) {
    const resolved = await resolveRuleset(ruleset, repo, gh);
    const live = await liveRuleset(gh, repo, ruleset.name);
    const differences = live ? rulesetDifferences(resolved.ruleset, live.ruleset) : [];
    let state: RulesetState['state'] = 'missing';
    if (live) {
      state = differences.length > 0 ? 'differs' : 'matches';
    }
    states.push({ file, name: ruleset.name, state, differences, notes: resolved.notes });
  }
  return states;
}

/**
 * Creates each ruleset in `root` on GitHub, or updates the one with the same
 * name with PUT. `writeInput` stores the request body in a file for `gh`.
 */
export async function applyRulesets(
  root: string,
  repo: string,
  gh: Gh,
  writeInput: (body: string) => Promise<string>,
) {
  const done: Array<{ file: string; name: string; action: 'created' | 'updated' }> = [];
  for (const { file, ruleset } of await readRulesets(root)) {
    const resolved = await resolveRuleset(ruleset, repo, gh);
    const live = await liveRuleset(gh, repo, ruleset.name);
    const input = await writeInput(JSON.stringify(resolved.ruleset));
    await ghJson(
      gh,
      live
        ? ['-X', 'PUT', `repos/${repo}/rulesets/${live.id}`, '--input', input]
        : ['-X', 'POST', `repos/${repo}/rulesets`, '--input', input],
    );
    done.push({ file, name: ruleset.name, action: live ? 'updated' : 'created' });
  }
  return done;
}

const stateText: Record<RulesetState['state'], string> = {
  matches: 'matches',
  differs: 'differs from',
  missing: 'not on GitHub, from',
};

/** One line for each ruleset, then each difference and note under it. */
export function renderRulesets(states: Array<RulesetState>) {
  if (states.length === 0) {
    return `No ruleset files in ${rulesetDir}.`;
  }
  return states
    .flatMap((item) => [
      `Ruleset ${item.name}: ${stateText[item.state]} ${item.file}`,
      ...item.differences.map((line) => `  ${line}`),
      ...item.notes.map((line) => `  note: ${line}`),
    ])
    .join('\n');
}
