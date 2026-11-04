import { text } from '@/factory/common';
import type { Kind } from '@/factory/common';

/** `runners/<name>.yaml`: a machine that runs agents. */
export const runnerKind: Kind = {
  id: 'runner',
  path: 'runners/<name>.yaml',
  format: 'yaml',
  schema: {
    title: 'runners/<name>.yaml',
    description: 'A machine that runs agents. The file name, without .yaml, is the runner name.',
    type: 'object',
    additionalProperties: false,
    required: ['description', 'machine', 't3_environment', 'workspace'],
    properties: {
      description: text('One line that says what the machine is for.'),
      machine: text('The host name of the machine.'),
      t3_environment: text('The T3 environment id of the machine, or local.'),
      workspace: {
        type: 'string',
        enum: ['worktree', 'main_checkout'],
        description:
          'worktree: each lane gets its own git worktree. main_checkout: agents work in the main checkout, one at a time.',
      },
      ssh: text('The SSH host alias that reaches the machine.'),
      setup: {
        type: 'array',
        description: 'Shell commands that make the machine ready, in order.',
        minItems: 1,
        items: text('A shell command.'),
      },
    },
  },
};
