import { harnesses, name, text } from '@/factory/common';
import type { Kind } from '@/factory/common';

const roles = ['foreman', 'triage', 'spec', 'implement', 'review', 'verify', 'custom'];

/** `agents/<name>/agent.md`: one agent. The frontmatter holds its settings. */
export const agentKind: Kind = {
  id: 'agent',
  path: 'agents/<name>/agent.md',
  format: 'markdown',
  body: 'The prompt of the agent.',
  schema: {
    title: 'agent.md frontmatter',
    description:
      'The settings of one agent in a factory tree. The folder name is the agent name. The body of the file is the prompt.',
    type: 'object',
    additionalProperties: false,
    required: ['role', 'description', 'harness', 'model', 'runner'],
    properties: {
      role: {
        type: 'string',
        enum: roles,
        description: 'The stage that the agent runs. At most 1 agent in a tree is the foreman.',
      },
      description: text('One line that says when to use this agent.'),
      harness: {
        type: 'string',
        enum: harnesses,
        description: 'The agent CLI that runs the agent.',
      },
      model: text('An id in models.yaml.'),
      runner: name('The name of a file in runners/, without .yaml.'),
    },
  },
};
