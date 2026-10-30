import { expect, test } from 'bun:test';

import { findWorkflowErrors } from '@tools/check-workflows';

const sha = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const file = '.github/workflows/ci.yml';

/** A workflow whose one job runs `steps`, or calls `uses` as a reusable workflow. */
function workflow({ steps = [], uses }: { steps?: Array<string>; uses?: string }) {
  const job = uses
    ? `    uses: ${uses}`
    : [
        '    runs-on: ubuntu-26.04',
        '    steps:',
        ...steps.map((step) => `      - uses: ${step}`),
      ].join('\n');
  return ['on: pull_request', 'permissions: { contents: read }', 'jobs:', '  build:', job].join(
    '\n',
  );
}

test('a SHA pin, a local path and a Docker digest pass', () => {
  const source = workflow({
    steps: [
      `actions/checkout@${sha} # v7.0.1`,
      './.github/actions/setup',
      `docker://alpine@sha256:${'a'.repeat(64)}`,
    ],
  });
  expect(findWorkflowErrors(file, source)).toEqual([]);
  expect(findWorkflowErrors(file, workflow({ uses: './.github/workflows/doctor.yml' }))).toEqual(
    [],
  );
});

test('a tag, a branch, a short SHA or a Docker tag fails and names the fix', () => {
  const errors = findWorkflowErrors(
    file,
    workflow({
      steps: [
        'actions/checkout@v7',
        'github/codeql-action/init@main',
        `actions/cache@${sha.slice(0, 7)}`,
        'docker://alpine:3',
      ],
    }),
  );
  expect(errors).toHaveLength(4);
  expect(errors[0]).toContain('`actions/checkout@<sha> # v7`');
  expect(errors[0]).toContain('gh api repos/actions/checkout/git/ref/tags/v7');
  expect(errors[1]).toContain('gh api repos/github/codeql-action/git/ref/tags/main');
  expect(errors[3]).toContain('sha256');
});

test('a reusable workflow from another repository needs a SHA pin too', () => {
  const uses = 'eggdev/clutch/.github/workflows/clutch-doctor.yml';
  expect(findWorkflowErrors(file, workflow({ uses: `${uses}@main` }))).toEqual([
    expect.stringContaining('job `build` uses'),
  ]);
  expect(findWorkflowErrors(file, workflow({ uses: `${uses}@${sha}` }))).toEqual([]);
});
