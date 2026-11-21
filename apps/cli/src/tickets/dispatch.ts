import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { claimPhase, linkTicket, readyPhases, setPhase, setThread } from '@/tickets/change';
import type { PhaseEntry, PhaseFile } from '@/tickets/phases';
import type { TicketStore } from '@/tickets/store';

/** What the driver needs: the store, the phase file and where the project is. */
export type Driver = {
  store: TicketStore;
  file: PhaseFile;
  actor: string;
  /** The name of the project in the path of the log. */
  project: string;
  /** The main checkout of the project, which T3 Code knows as the project. */
  projectDir: string;
};

type LogLine = {
  kind: 'start' | 'skip' | 'fail';
  ticket: string;
  phase: string;
  thread?: string;
  reason?: string;
  error?: string;
};

/** `$XDG_STATE_HOME/clutch/<project>/dispatch.jsonl`, by default under `~/.local/state`. */
function logFile(project: string) {
  const state = process.env.XDG_STATE_HOME || path.join(homedir(), '.local', 'state');
  return path.join(state, 'clutch', project, 'dispatch.jsonl');
}

async function log(driver: Driver, line: LogLine) {
  const file = logFile(driver.project);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify({ time: new Date().toISOString(), ...line })}\n`);
  return line;
}

/** Runs the `t3` on the PATH. Throws its error output when it exits with an error. */
async function t3(...args: Array<string>) {
  const proc = Bun.spawn(['t3', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`t3 ${args[0]} ${args[1]} exited ${code}: ${(err || out).trim()}`);
  }
  return out;
}

const slug = (title: string) =>
  title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .slice(0, 40)
    .replaceAll(/^-+|-+$/gu, '');

/** The prompt, the skills to use, and how to read the ticket and end the phase. */
function promptOf(id: string, phase: string, text: string, skills: Array<string> = []) {
  return [
    text,
    skills.length > 0 ? `Use these skills: ${skills.join(', ')}.` : '',
    `Read the ticket with \`clutch tickets show ${id}\`. When the phase is done, run \`clutch tickets phase ${id} ${phase} done\`.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const entryOf = (file: PhaseFile, phase: string) => file.phases.find((entry) => entry.id === phase);

/** The phases that run now, and how many of them count against each limit. */
function running(driver: Driver) {
  const rows = driver.store.db
    .query<{ phase: string }, []>("SELECT phase FROM phases WHERE status = 'in_progress'")
    .all()
    .map((row) => entryOf(driver.file, row.phase));
  return {
    threads: rows.filter((entry) => entry?.thread === 'work').length,
    device: rows.filter((entry) => entry?.needs?.includes('device')).length,
  };
}

/** The limit that a start of `entry` would pass, or null when it fits. */
function limitPassed(driver: Driver, entry: PhaseEntry) {
  const now = running(driver);
  if (entry.thread === 'work' && now.threads >= driver.file.limits.threads) {
    return `limits.threads is ${driver.file.limits.threads}`;
  }
  if (entry.needs?.includes('device') && now.device >= driver.file.limits.device) {
    return `limits.device is ${driver.file.limits.device}`;
  }
  return null;
}

/** The work thread of a ticket: the thread that an earlier work phase saved. */
function workThread(driver: Driver, id: string) {
  return driver.store
    .phases(id)
    .find((row) => row.thread && entryOf(driver.file, row.phase)?.thread === 'work')?.thread;
}

/** Starts the thread of a claimed phase, or sends the prompt to the work thread. Returns the thread id. */
async function startThread(driver: Driver, row: { id: string; phase: string; title: string }) {
  const entry = entryOf(driver.file, row.phase) as PhaseEntry;
  const prompt = promptOf(row.id, row.phase, entry.prompt, entry.skills);
  const existing = entry.thread === 'work' ? workThread(driver, row.id) : null;
  if (existing) {
    await t3('thread', 'send', existing, prompt);
    return existing;
  }
  const model = entry.thread === 'work' ? driver.file.work_thread : entry;
  const branch = `clutch/${row.id.toLowerCase()}-${slug(row.title)}`;
  const out = await t3(
    'thread',
    'start',
    '--json',
    '--title',
    `${row.id} ${row.phase}: ${row.title}`,
    ...(model.provider && model.model
      ? ['--provider', model.provider, '--model', model.model]
      : []),
    ...(entry.thread === 'work' ? ['--worktree', 'origin/main', '--branch', branch] : []),
    driver.projectDir,
    prompt,
  );
  const { threadId } = JSON.parse(out) as { threadId: string };
  if (entry.thread === 'work') {
    linkTicket(driver.store, driver.actor, row.id, { kind: 'branch', value: branch });
    // `start` prints no worktree, so ask the thread for it. A check runs there.
    const shown = JSON.parse(await t3('thread', 'show', '--json', threadId)) as {
      thread: { worktreePath: string | null };
    };
    if (shown.thread.worktreePath) {
      const value = shown.thread.worktreePath;
      linkTicket(driver.store, driver.actor, row.id, { kind: 'worktree', value });
    }
  }
  return threadId;
}

/**
 * Starts the thread of each ready phase that fits the limits. The claim makes
 * the start safe from several processes at once: a phase that another process
 * claimed first is left to it. A ready phase with no entry in the phase file
 * stays ready. A start that fails sets the phase back to `ready` with the
 * error, so the next dispatch tries again.
 */
export async function dispatch(driver: Driver) {
  const lines: Array<LogLine> = [];
  for (const row of readyPhases(driver.store)) {
    const at = { ticket: row.id, phase: row.phase };
    const entry = entryOf(driver.file, row.phase);
    if (!entry) {
      lines.push(
        await log(driver, { kind: 'skip', ...at, reason: 'The phase file has no entry.' }),
      );
      continue;
    }
    // The limit check and the claim are one transaction, so two processes cannot both pass a limit.
    let limit: string | null;
    try {
      limit = driver.store.db
        .transaction(() => {
          const passed = limitPassed(driver, entry);
          if (!passed) {
            claimPhase(driver.store, driver.actor, row.id, row.phase, null);
          }
          return passed;
        })
        .immediate();
    } catch {
      // Another process claimed the phase first, so it starts the thread.
      continue;
    }
    if (limit) {
      lines.push(await log(driver, { kind: 'skip', ...at, reason: `${limit}.` }));
      continue;
    }
    try {
      const thread = await startThread(driver, row);
      setThread(driver.store, driver.actor, row.id, { phase: row.phase, thread });
      lines.push(await log(driver, { kind: 'start', ...at, thread }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPhase(driver.store, driver.actor, row.id, {
        phase: row.phase,
        status: 'ready',
        reason: `The thread did not start: ${message}`,
      });
      lines.push(await log(driver, { kind: 'fail', ...at, error: message }));
    }
  }
  return lines;
}

/** Sends the prompt of `status` to the thread of the phase, when the phase file has one. */
export async function sendStatusPrompt(driver: Driver, id: string, phase: string, status: string) {
  const prompt = entryOf(driver.file, phase)?.statuses?.[status as 'blocked'];
  const { thread } = driver.store.phase(id, phase);
  if (!prompt?.prompt || !thread) {
    return null;
  }
  try {
    await t3('thread', 'send', thread, promptOf(id, phase, prompt.prompt, prompt.skills));
    return await log(driver, { kind: 'start', ticket: id, phase, thread, reason: status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return await log(driver, { kind: 'fail', ticket: id, phase, thread, error: message });
  }
}

/**
 * Refuses `done` on a phase whose entry says `advance: owner` with no approval
 * by the owner, or whose `check` fails in the worktree of the ticket. Returns
 * the reason to record: the owner's words, for an approval.
 */
export async function checkDone(
  driver: Driver,
  done: { id: string; phase: string; cwd: string; approvedBy?: string; quote?: string },
) {
  const entry = entryOf(driver.file, done.phase);
  if (entry?.advance === 'owner' && (done.approvedBy !== 'owner' || !done.quote)) {
    throw new Error(
      `${done.id} ${done.phase} needs the owner: pass --approved-by owner --quote <the owner's words>.`,
    );
  }
  if (entry?.check) {
    const worktree = driver.store
      .ticket(done.id)
      .links.findLast((link) => link.kind === 'worktree')?.value;
    const proc = Bun.spawn(['sh', '-c', entry.check], {
      cwd: worktree ?? done.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) {
      const tail = `${out}${err}`.trim().split('\n').slice(-20).join('\n');
      throw new Error(`The check of ${done.phase} failed (${entry.check}):\n${tail}`);
    }
  }
  return entry?.advance === 'owner' ? `Approved by owner: "${done.quote}"` : null;
}
