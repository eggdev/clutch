import { must, prWithHead } from '@tools/github/github';
import type { Clock } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

const workflow = 'open-pr.yml';
/** How long `pr open` waits for the bot's PR, and how often it looks. */
const botTiming = { timeout: 180_000, interval: 5000 };

/**
 * Whether the release bot can open PRs here: the default branch has the Open
 * PR workflow, and the repository sets `CLUTCH_APP_ID`. The key itself is
 * secret, so a missing key shows only when the workflow run fails.
 */
async function botReady(run: Run, trunk: string) {
  const id = await run([
    'gh',
    'api',
    'repos/{owner}/{repo}/actions/variables/CLUTCH_APP_ID',
    '--jq',
    '.value',
  ]);
  if (!id.ok || !id.out.trim()) {
    return false;
  }
  const file = await run([
    'gh',
    'api',
    `repos/{owner}/{repo}/contents/.github/workflows/${workflow}?ref=${trunk}`,
    '--silent',
  ]);
  return file.ok;
}

/**
 * Asks the Open PR workflow on the default branch to open the PR as the
 * release bot, then waits for it. GitHub never lets a PR's author approve it,
 * so the owner can approve a PR that the bot opened. Returns false when the
 * bot is not set up, or no PR appeared before the timeout, so the caller
 * opens the PR as the user.
 */
export async function openAsBot(
  run: Run,
  clock: Clock,
  pr: { trunk: string; branch: string; base: string; title: string },
  timing: { timeout: number; interval: number } = botTiming,
) {
  if (!(await botReady(run, pr.trunk))) {
    return false;
  }
  const started = await run([
    'gh',
    'workflow',
    'run',
    workflow,
    '--ref',
    pr.trunk,
    '-f',
    `head=${pr.branch}`,
    '-f',
    `base=${pr.base}`,
    '-f',
    `title=${pr.title}`,
  ]);
  if (!started.ok) {
    console.log(`Could not start ${workflow}: ${started.err.trim()}. Opening the PR as you.`);
    return false;
  }
  const end = clock.now() + timing.timeout;
  while (clock.now() < end) {
    await clock.sleep(timing.interval);
    if (await prWithHead(run, pr.branch)) {
      return true;
    }
  }
  const runs = await must(run, [
    'gh',
    'run',
    'list',
    '--workflow',
    workflow,
    '--limit',
    '1',
    '--json',
    'url',
    '--jq',
    '.[0].url',
  ]);
  console.log(
    `The release bot opened no PR in time. Read ${runs || workflow}. Opening the PR as you.`,
  );
  return false;
}
