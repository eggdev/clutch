import { name, text } from '@/factory/common';
import type { Kind } from '@/factory/common';

/** `scorers/<name>/scorer.md`: a judge that grades the runs of some agents. */
export const scorerKind: Kind = {
  id: 'scorer',
  path: 'scorers/<name>/scorer.md',
  format: 'markdown',
  body: 'The judge prompt.',
  schema: {
    title: 'scorer.md frontmatter',
    description:
      'A judge that grades the runs of some agents. The folder name is the scorer name. The body of the file is the judge prompt.',
    type: 'object',
    additionalProperties: false,
    required: ['agents', 'judge', 'labels', 'passingScore', 'samplingRate'],
    properties: {
      description: text('One line that says what the scorer grades.'),
      agents: {
        type: 'array',
        description: 'The agents whose runs the scorer grades.',
        minItems: 1,
        uniqueItems: true,
        items: name('The name of a folder in agents/.'),
      },
      judge: text('An id in models.yaml, or the name of the person who grades.'),
      labels: {
        type: 'array',
        description:
          'The grades that the judge picks from. At least 1 label passes and at least 1 fails.',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['value', 'score', 'description'],
          properties: {
            value: {
              type: 'string',
              pattern: '^[a-z0-9]+(?:[-_][a-z0-9]+)*$',
              description:
                'The label that the judge returns. Lowercase, with - or _ between words.',
            },
            score: { type: 'number', minimum: 0, maximum: 1, description: 'From 0 to 1.' },
            description: text('What the label means.'),
          },
        },
      },
      passingScore: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'A run passes when its label scores this or more.',
      },
      samplingRate: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'The percent of runs that the scorer grades.',
      },
    },
  },
};
