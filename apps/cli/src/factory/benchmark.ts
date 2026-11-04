import { name, text } from '@/factory/common';
import type { Kind } from '@/factory/common';

/**
 * `benchmarks/<name>/benchmark.md`: a suite that runs one agent with 2 to 6
 * models on tasks pinned to commits. `clutch bench <name>` runs it.
 */
export const benchmarkKind: Kind = {
  id: 'benchmark',
  path: 'benchmarks/<name>/benchmark.md',
  format: 'markdown',
  body: 'What the suite measures.',
  schema: {
    title: 'benchmark.md frontmatter',
    description:
      'A suite that runs one agent with 2 to 6 models on tasks pinned to commits. The folder name is the suite name. The body of the file says what the suite measures.',
    type: 'object',
    additionalProperties: false,
    required: ['description', 'agent', 'configs', 'tasks'],
    properties: {
      description: text('One line that says what the suite compares.'),
      agent: name('The name of a folder in agents/. Each run sends its prompt.'),
      configs: {
        type: 'array',
        description:
          'The setups to compare. Each one runs the agent with its own model, and models.yaml gives the harness.',
        minItems: 2,
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'model'],
          properties: {
            name: name('The name that the results and --config use.'),
            model: text('An id in models.yaml.'),
          },
        },
      },
      tasks: {
        type: 'array',
        description: 'The work that each config does. Each task starts from its own commit.',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'commit', 'issue', 'check'],
          properties: {
            name: name('The name that the results and --task use.'),
            commit: {
              type: 'string',
              pattern: '^[0-9a-f]{40}$',
              description: 'The full SHA of the commit that the task starts from.',
            },
            issue: {
              type: 'string',
              pattern: '^[\\w.-]+(?:/[\\w.-]+)*$',
              description:
                'The path of the issue file at the commit, from the repository root. The agent gets its text.',
            },
            check: text(
              'The shell command that grades the result in the checkout. Exit 0 passes. $CLUTCH_BENCH_REPO is the repository that runs the suite.',
            ),
          },
        },
      },
    },
  },
};
