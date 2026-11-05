import { name, text } from '@/factory/common';
import type { Kind } from '@/factory/common';
import type { ObjectSchema } from '@/factory/json-schema';

const type = (value: string) => ({ type: 'string' as const, const: value });

const schedule: ObjectSchema = {
  type: 'object',
  description: 'Runs at a time of day.',
  additionalProperties: false,
  required: ['type', 'time'],
  properties: {
    type: type('schedule'),
    time: {
      type: 'string',
      pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$',
      description: "The runner's local time, as HH:MM.",
    },
    weekdays: {
      type: 'array',
      description: 'The days to run, 0 is Sunday. Leave it out for every day.',
      minItems: 1,
      maxItems: 7,
      uniqueItems: true,
      items: { type: 'integer', minimum: 0, maximum: 6 },
    },
  },
};

const github: ObjectSchema = {
  type: 'object',
  description: 'Runs on a GitHub event in a repository.',
  additionalProperties: false,
  required: ['type', 'event'],
  properties: {
    type: type('github'),
    event: {
      type: 'string',
      pattern: '^[a-z][a-z_]*$',
      description: 'The event, such as issue_labeled. Snake case.',
    },
    label: text('Only an issue or a PR with this label.'),
  },
};

const linear: ObjectSchema = {
  type: 'object',
  description: 'Runs on a Linear issue.',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: type('linear'),
    label: text('Only an issue with this label.'),
  },
};

const webhook: ObjectSchema = {
  type: 'object',
  description: 'Runs on a call to a webhook.',
  additionalProperties: false,
  required: ['type'],
  properties: { type: type('webhook') },
};

/** `automations/<name>/automation.md`: when an agent starts without a person. */
export const automationKind: Kind = {
  id: 'automation',
  path: 'automations/<name>/automation.md',
  format: 'markdown',
  body: 'The starting prompt that the agent gets.',
  schema: {
    title: 'automation.md frontmatter',
    description:
      'What starts an agent without a person. The folder name is the automation name. The body of the file is the starting prompt.',
    type: 'object',
    additionalProperties: false,
    required: ['agent', 'trigger'],
    properties: {
      description: text('One line that says what the automation does.'),
      agent: name('The name of a folder in agents/.'),
      trigger: {
        description: 'What starts the agent. The type decides the other keys.',
        oneOf: [schedule, github, linear, webhook],
      },
      enabled: {
        type: 'boolean',
        default: true,
        description: 'false stops the automation and keeps the file.',
      },
    },
  },
};
