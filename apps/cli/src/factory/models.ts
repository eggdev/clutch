import { harnesses, text } from '@/factory/common';
import type { Kind } from '@/factory/common';

/** `models.yaml`: each model that an agent or a scorer may name. */
export const modelsKind: Kind = {
  id: 'models',
  path: 'models.yaml',
  format: 'yaml',
  schema: {
    title: 'models.yaml',
    description: 'Each model that an agent or a scorer in the tree may name.',
    type: 'object',
    additionalProperties: false,
    required: ['models'],
    properties: {
      models: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'harness'],
          properties: {
            id: {
              type: 'string',
              pattern: '^\\S+$',
              description: 'The model id that the harness takes, such as claude-opus-5-5.',
            },
            harness: {
              type: 'string',
              enum: harnesses,
              description: 'The agent CLI that runs the model.',
            },
            where: text('Where the model runs and how to reach it.'),
            base_url: {
              type: 'string',
              pattern: '^https?://\\S+$',
              description:
                'The base URL of an OpenAI-compatible server for the model, such as http://localhost:11434/v1. A scorer that judges with a qwen model needs it.',
            },
          },
        },
      },
    },
  },
};
