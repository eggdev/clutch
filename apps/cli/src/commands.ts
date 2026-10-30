import { doctorCommand } from '@/doctor-command';
import { initCommand } from '@/init-command';
import { installCommand } from '@/install-command';
import { issuesCommand } from '@/issues-command';
import { syncCommand } from '@/sync-command';

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
  doctor: {
    usage:
      'clutch doctor [--root DIR] [--json] [--remote [--repo OWNER/NAME]] [--category C] [--phase P]\nclutch doctor --check\nclutch doctor --write-baseline [--allow-downgrade]',
    summary: 'Report which capabilities a repository has, next to what its clutch.yaml declares.',
    run: doctorCommand,
    clone: true,
  },
  init: {
    usage: 'clutch init [--root DIR] [--mode sync|doctor] [--adopt] [--yes]',
    summary:
      'Adopt Clutch in a repository: write clutch.yaml, the tracker and the doctor baseline.',
    run: (args, cwd) => initCommand(args, cwd),
    clone: true,
  },
  sync: {
    usage:
      'clutch sync [--root DIR] [--to <commit> | --latest] [--only GROUP] [--check] [--json]\nclutch sync --only review   (the shared review tooling only)',
    summary: 'Move a project to a Clutch commit. --check exits 2 when a sync would change files.',
    run: (args, cwd) => syncCommand(args, cwd),
    clone: true,
  },
  issues: {
    usage:
      'clutch issues [--write | --check] [--json]\nclutch issues next [--stack] [--json]\nclutch issues set <id> <status> [--pr URL] [--owner NAME]',
    summary: 'List, pick and update the issues in .clutch/issues, and render .clutch/TRACKER.md.',
    run: issuesCommand,
  },
};

export function usage(names = Object.keys(commands)) {
  return names.map((name) => `${commands[name].usage}\n  ${commands[name].summary}`).join('\n\n');
}
