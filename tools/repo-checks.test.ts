import { expect, test } from 'bun:test';

import { checkDependencyOverrides, duplicateKeys } from '@tools/check-dependency-overrides';
import { checkWorkflows, findWorkflowErrors } from '@tools/check-workflows';
import { inRepo } from '@tools/testing/in-repo';

test('workflows reject a step or job reference that names nothing, and accept real ones', () => {
  const workflow = `
name: Deploy
on: { push: { branches: [main] }, workflow_call: { outputs: { url: { value: "\${{ jobs.ship.outputs.url }}" }, id: { value: "\${{ jobs.shp.outputs.id }}" } } } }
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      tag: \${{ steps.version.outputs.tag }}
    steps:
      - id: version
        run: echo "tag=1" >> "$GITHUB_OUTPUT"
      - if: steps.versoin.outcome == 'success'
        run: echo "steps.shell text is not an expression"
      - run: echo "\${{ github.event.inputs.steps.x }}"
  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: needs.build.outputs.tag != ''
    steps:
      - run: echo "\${{ needs.biuld.outputs.tag }} \${{ needs.build.outputs.tag }}"
  ship:
    needs: [deploy, test]
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ steps.version.outputs.tag }}"
`;
  expect(findWorkflowErrors('deploy.yml', workflow)).toEqual([
    'deploy.yml: job `build` reads `steps.versoin`. Give a step in this job `id: versoin`, or fix the name.',
    "deploy.yml: job `deploy` reads `needs.biuld`. Add `biuld` to the job's `needs`, or fix the name.",
    'deploy.yml: job `ship` needs `test`, which is not a job.',
    'deploy.yml: job `ship` reads `steps.version`. Give a step in this job `id: version`, or fix the name.',
    'deploy.yml: `jobs.shp` names no job. Fix the name.',
  ]);
});

test('workflows need a permissions block and never use pull_request_target', async () => {
  expect(
    await inRepo(
      {
        '.github/workflows/ci.yml': 'on: [pull_request_target]\njobs: {}\n',
        '.github/workflows/ok.yaml': 'on: pull_request\npermissions: {}\njobs: {}\n',
      },
      checkWorkflows,
    ),
  ).toEqual([
    '.github/workflows/ci.yml: add a top-level `permissions` block. Start from `contents: read` and grant more per job.',
    ".github/workflows/ci.yml: `pull_request_target` runs fork code with the base repository's secrets. Use `pull_request`.",
  ]);
  expect(await inRepo({ 'README.md': '' }, checkWorkflows)).toEqual([]);
});

test('overrides need a heading with a reason, and a heading for a removed override is stale', async () => {
  const page = 'docs/contributing/setup/dependencies.md';
  expect(
    await inRepo(
      {
        'package.json': JSON.stringify({
          overrides: { esbuild: '0.28.2', undocumented: '1.0.0', bare: '2.0.0' },
          resolutions: { 'left-pad': '1.3.0' },
        }),
        [page]: [
          '# Dependencies',
          '## Overrides',
          '### `esbuild` to `0.28.2`',
          '',
          'Floors esbuild above GHSA-xxxx. Remove it when vite ships 0.28.',
          '### `left-pad`',
          'Pins one copy.',
          '### `bare`',
          '',
          '### `removed`',
          'Was here once.',
          '```md',
          '### `undocumented`',
          '```',
          '## Audit',
          '### `undocumented`',
          'A heading outside the overrides section does not count.',
        ].join('\n'),
      },
      checkDependencyOverrides,
    ),
  ).toEqual([
    'package.json: `overrides.undocumented` has no heading in docs/contributing/setup/dependencies.md. Add "### `undocumented`" under "## Overrides" with the reason.',
    `${page}:8: \`bare\` has no reason. Say why the override exists and what removes it.`,
    `${page}:10: \`removed\` is not in package.json overrides. Delete the stale section.`,
  ]);
  expect(await inRepo({ 'package.json': '{"name":"x"}' }, checkDependencyOverrides)).toEqual([]);
});

test('package.json rejects a repeated key at any depth', async () => {
  expect(duplicateKeys('{"a":1,"b":{"x":[{"y":2,"y":"}"}],"x":0},"a":[]}')).toEqual([
    'b.x[0].y',
    'b.x',
    'a',
  ]);
  expect(
    await inRepo(
      { 'package.json': '{"overrides":{"esbuild":"1","esbuild":"2"}}' },
      checkDependencyOverrides,
    ),
  ).toEqual([
    'package.json: `overrides.esbuild` repeats. JSON keeps only the last value. Delete one.',
    'package.json: `overrides.esbuild` has no heading in docs/contributing/setup/dependencies.md. Add "### `esbuild`" under "## Overrides" with the reason.',
  ]);
});
