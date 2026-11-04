import { benchCommand } from '@/bench-command';
import { checksCommand } from '@/checks-command';
import { doctorCommand } from '@/doctor-command';
import { factoryCommand } from '@/factory-command';
import { frictionCommand } from '@/friction-command';
import { initCommand } from '@/init-command';
import { installCommand } from '@/install-command';
import { issuesCommand } from '@/issues-command';
import { labelsCommand } from '@/labels-command';
import { metricsCommand } from '@/metrics-command';
import { ratchetCommand } from '@/ratchet-command';
import { riskCommand } from '@/risk-command';
import { rulesetCommand } from '@/ruleset-command';
import { syncCommand } from '@/sync-command';
import { worktreeCommand } from '@/worktree-command';

type Command = {
  usage: string;
  summary: string;
  run: (args: Array<string>, cwd: string) => Promise<number>;
  /** The command reads Clutch's own files, so it runs only from a Clutch clone. */
  clone?: true;
};

/** Each `clutch <name>` command. With no command, the CLI runs `install`. */
export const commands: Record<string, Command> = {
  install: {
    usage: 'clutch [install] [--yes] [--agent NAME]',
    summary: 'Install Clutch into this project, then run or hand off the kickoff stages.',
    run: installCommand,
    clone: true,
  },
  checks: {
    usage: 'clutch checks --changed [--base REF]',
    summary:
      'Run the validate targets of only the projects that the change affects, and the root checks.',
    run: checksCommand,
  },
  doctor: {
    usage:
      'clutch doctor [--root DIR] [--json] [--remote [--repo OWNER/NAME]] [--category C] [--phase P]\nclutch doctor --check\nclutch doctor --write-baseline [--allow-downgrade]',
    summary: 'Report which capabilities a repository has, next to what its clutch.yaml declares.',
    run: doctorCommand,
  },
  factory: {
    usage: 'clutch factory --check [--root DIR] [--json]\nclutch factory --write-schemas DIR',
    summary:
      'Check the factory tree: its agents, automations, runners, scorers and models. Exits 1 on a problem.',
    run: factoryCommand,
  },
  bench: {
    usage: 'clutch bench <name> [--config NAME] [--task NAME] [--json]',
    summary:
      'Run each task of a benchmark suite with each of its models, in scratch clones, and print pass, time and lines. A whole run writes its result file.',
    run: benchCommand,
  },
  init: {
    usage: 'clutch init [--root DIR] [--mode sync|doctor] [--adopt] [--yes]',
    summary:
      'Adopt Clutch in a repository: write clutch.yaml, the tracker and the doctor baseline.',
    run: (args, cwd) => initCommand(args, cwd),
  },
  sync: {
    usage:
      'clutch sync [--root DIR] [--to <tag or commit>] [--only GROUP] [--check] [--json]\nclutch sync --only review   (the shared review tooling only)',
    summary:
      'Move a project to the latest Clutch release. --check exits 2 when the project is behind it.',
    run: (args, cwd) => syncCommand(args, cwd),
  },
  issues: {
    usage:
      'clutch issues [--write | --check] [--json]\nclutch issues next [--stack] [--json]\nclutch issues set <id> <status> [--pr URL] [--owner NAME]\nclutch issues new --phase P --title TEXT [--depends CL-NNN,...] [--owner NAME] [--range CL-NNN..CL-NNN]',
    summary: 'List, pick and update the issues in .clutch/issues, and render .clutch/TRACKER.md.',
    run: issuesCommand,
  },
  friction: {
    usage:
      'clutch friction add "<text>" [--issue CL-NNN] [--kind tooling|docs|check|flake] [--file PATH]\nclutch friction list [--since 7d] [--json] [--file PATH]',
    summary:
      'Record friction that slowed a task, in .clutch/friction.jsonl, or list it for the gardening pass.',
    run: (args, cwd) => frictionCommand(args, cwd),
  },
  metrics: {
    usage:
      'clutch metrics [--since 14d] [--repo OWNER/NAME] [--root DIR] [--owner LOGIN] [--json]\nclutch metrics --verdicts [--since 14d] [--owner LOGIN] [--json]',
    summary: 'Report how pull requests flow through a repository, from read-only gh api calls.',
    run: (args, cwd) => metricsCommand(args, cwd),
  },
  labels: {
    usage: 'clutch labels [--base REF] [--head REF] [--title TEXT] [--json]',
    summary:
      'Print the kind label of a PR title and an area label for each part of the repository the change touches.',
    run: labelsCommand,
  },
  ratchet: {
    usage:
      'clutch ratchet check [--base REF] [--json]\nclutch ratchet update\nclutch ratchet add <name> (--pattern REGEX | --command CMD) --files GLOB',
    summary:
      'Check, lower and add the shrink-only counts of old violations in .clutch/ratchets.json.',
    run: ratchetCommand,
  },
  risk: {
    usage: 'clutch risk [--base REF] [--head REF] [--json]',
    summary:
      'Print the risk tier of the change from the merge base of --base to --head, by the paths in .clutch/risk.yaml.',
    run: riskCommand,
  },
  worktree: {
    usage:
      'clutch worktree new <slug> [--issue CL-NNN] [--base REF]\nclutch worktree list [--json]\nclutch worktree rm <slug> [--force] [--base REF]',
    summary:
      'Make a separate checkout for one task, with its own branch, copied files and setup. List the checkouts, or remove one.',
    run: worktreeCommand,
  },
  ruleset: {
    usage: 'clutch ruleset [--apply] [--root DIR] [--repo OWNER/NAME] [--json]',
    summary:
      'Compare .github/rulesets with GitHub. --apply creates each ruleset, or updates it by name.',
    run: rulesetCommand,
  },
};

export function usage(names = Object.keys(commands)) {
  return names.map((name) => `${commands[name].usage}\n  ${commands[name].summary}`).join('\n\n');
}
