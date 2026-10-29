import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { guardrailList, guardrailPatterns } from '@tools/agent-hooks/guard-guardrails';
import { simulatorTools } from '@tools/agent-hooks/simulator-tools';

/**
 * Claude Code and Codex run the same agent hooks. Each tool has its own
 * config file, and both call the scripts in `.agents/hooks/`. This check
 * keeps the two files in step, and keeps .github/CODEOWNERS in step with the
 * guardrail list. See docs/contributing/harness-engineering.md#agent-hooks.
 */
export const configs = { claude: '.claude/settings.json', codex: '.codex/hooks.json' } as const;
const scripts = '.agents/hooks';
const codeowners = '.github/CODEOWNERS';
const script = /\.agents\/hooks\/([\w-]+)\.ts\s+(\w+)/u;

type Config = {
  hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>>;
};

/** Each `<event> <script>` pair that a config file registers, and each command with the wrong agent. */
function registrations(config: Config, agent: string) {
  const pairs = new Set<string>();
  const problems: Array<string> = [];
  for (const [event, groups] of Object.entries(config.hooks ?? {})) {
    for (const handler of groups.flatMap((group) => group.hooks ?? [])) {
      const match = script.exec(handler.command ?? '');
      if (!match) {
        problems.push(
          `the ${event} hook \`${handler.command}\` does not run a script in ${scripts}/. Call \`mise exec -- bun ${scripts}/<name>.ts ${agent}\`.`,
        );
      } else if (match[2] === agent) {
        pairs.add(`${event} ${match[1]}`);
      } else {
        problems.push(`the ${event} hook passes \`${match[2]}\` as the agent. Pass \`${agent}\`.`);
      }
    }
  }
  return { pairs, problems };
}

/**
 * Claude Code alone has the iOS Simulator tools, so only its config sends them
 * to `guard-dev-servers`. Its matcher must name each one.
 */
function simulatorProblems(config: Config): Array<string> {
  const matchers = (config.hooks?.PreToolUse ?? [])
    .filter((group) =>
      group.hooks?.some((handler) => handler.command?.includes('/guard-dev-servers.ts')),
    )
    .map((group) => new RegExp(`^(?:${group.matcher ?? '.*'})$`, 'u'));
  if (matchers.length === 0) {
    return [];
  }
  return Object.values(simulatorTools)
    .filter((tool) => !matchers.some((matcher) => matcher.test(tool)))
    .map(
      (tool) =>
        `the PreToolUse matcher of guard-dev-servers misses \`${tool}\`. Add it, so the hook sees each simulator call.`,
    );
}

/** The CODEOWNERS pattern for a guardrail glob: `tools/lint/**` becomes `/tools/lint/`. */
export const ownerPattern = (glob: string) => `/${glob.endsWith('/**') ? glob.slice(0, -2) : glob}`;

async function codeownerProblems(root: string): Promise<Array<string>> {
  const file = path.join(root, codeowners);
  if (!existsSync(file)) {
    return [`${codeowners}: the file is missing. Restore it from the project template.`];
  }
  const owned = new Map<string, Array<string>>();
  const text = await Bun.file(file).text();
  for (const line of text.split('\n')) {
    const [pattern, ...owners] = line.trim().split(/\s+/u);
    if (pattern && !pattern.startsWith('#')) {
      owned.set(pattern, owners);
    }
  }
  const problems: Array<string> = [];
  for (const glob of guardrailPatterns(root)) {
    const pattern = ownerPattern(glob);
    if (!owned.has(pattern)) {
      problems.push(
        `${codeowners}: add \`${pattern}\` with an owner. ${guardrailList} lists \`${glob}\`.`,
      );
    } else if (!owned.get(pattern)?.length) {
      problems.push(`${codeowners}: \`${pattern}\` has no owner. Add a handle or a team.`);
    }
  }
  return problems;
}

export async function checkAgentHooks(root: string): Promise<Array<string>> {
  const problems: Array<string> = [];
  const found: Record<string, Set<string>> = {};
  for (const [agent, file] of Object.entries(configs)) {
    if (!existsSync(path.join(root, file))) {
      problems.push(`${file}: the file is missing. Restore it from the project template.`);
      continue;
    }
    const config: Config = await Bun.file(path.join(root, file)).json();
    const result = registrations(config, agent);
    if (agent === 'claude') {
      result.problems.push(...simulatorProblems(config));
    }
    problems.push(...result.problems.map((problem) => `${file}: ${problem}`));
    found[agent] = result.pairs;
  }
  const { claude = new Set<string>(), codex = new Set<string>() } = found;
  for (const pair of [...claude].filter((item) => !codex.has(item))) {
    problems.push(`${configs.codex}: register the ${pair} hook that ${configs.claude} has.`);
  }
  for (const pair of [...codex].filter((item) => !claude.has(item))) {
    problems.push(`${configs.claude}: register the ${pair} hook that ${configs.codex} has.`);
  }
  const named = new Set([...claude, ...codex].map((pair) => pair.split(' ')[1]));
  const present = existsSync(path.join(root, scripts))
    ? readdirSync(path.join(root, scripts))
        .filter((entry) => entry.endsWith('.ts'))
        .map((entry) => entry.slice(0, -3))
        .toSorted()
    : [];
  for (const name of named) {
    if (!present.includes(name)) {
      problems.push(`${scripts}/${name}.ts: a hook calls it, but it does not exist.`);
    }
  }
  for (const name of present.filter((entry) => !named.has(entry))) {
    problems.push(
      `${scripts}/${name}.ts: no hook calls it. Register it in both configs, or delete it.`,
    );
  }
  problems.push(...(await codeownerProblems(root)));
  return problems;
}

if (import.meta.main) {
  const problems = await checkAgentHooks(process.cwd());
  if (problems.length) {
    console.error(
      [
        `Agent hook check failed (${problems.length}).`,
        'Claude Code and Codex must run the same hooks, and CODEOWNERS must cover each guardrail file.',
        'See docs/contributing/harness-engineering.md#agent-hooks.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log(
      'Claude Code and Codex run the same agent hooks, and CODEOWNERS covers each guardrail file.',
    );
  }
}
