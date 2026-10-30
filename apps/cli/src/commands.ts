import { doctorCommand } from '@/doctor-command';
import { cliRoot } from '@/format';
import { installCommand } from '@/install-command';
import { issuesCommand } from '@/issues-command';
import { reviewCommand } from '@/review-command';

type Command = {
  usage: string;
  summary: string;
  run: (args: Array<string>, cwd: string) => Promise<number>;
};

/** Each `clutch <name>` command. With no command, the CLI runs `install`. */
export const commands: Record<string, Command> = {
  install: {
    usage: 'clutch [install] [--yes] [--agent NAME]',
    summary: 'Install Clutch into this project, then run or hand off the kickoff stages.',
    run: installCommand,
  },
  review: {
    usage: 'clutch review install [--check] [--json]',
    summary:
      'Install only the shared review tooling. Project-specific verify and custom files stay.',
    run: (args, cwd) => reviewCommand(args, cwd, cliRoot),
  },
  doctor: {
    usage: 'clutch doctor [--root DIR] [--json] [--remote] [--category C] [--phase P]',
    summary: 'Report which capabilities a repository has, next to what its clutch.yaml declares.',
    run: doctorCommand,
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
