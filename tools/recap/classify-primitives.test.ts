import { expect, test } from 'bun:test';

import { classify } from '@tools/recap/classify-primitives';
import { inRepo } from '@tools/testing/in-repo';

const registry = {
  'docs/contributing/architecture/primitives.yaml': `
version: 1
groups:
  - id: platform
    name: Platform
primitives:
  - id: billing
    group: platform
    code: [packages/billing/]
  - id: billing-webhooks
    group: platform
    code: [packages/billing/src/webhooks/]
  - id: web
    code: [apps/web/, tools/web.ts]
invariants:
  - id: paid-plans
    summary: A team pays before it uses a paid feature.
`,
};

test('each path goes to the primitive with the longest root that owns it', async () => {
  const result = await inRepo(registry, (root) =>
    classify(root, [
      'packages/billing/src/plan.ts',
      'packages/billing/src/webhooks/stripe.ts',
      'apps/web/src/page.tsx',
      'packages/billing/package.json',
    ]),
  );
  expect(result.touched).toEqual([
    {
      id: 'billing',
      group: 'platform',
      files: ['packages/billing/src/plan.ts', 'packages/billing/package.json'],
    },
    {
      id: 'billing-webhooks',
      group: 'platform',
      files: ['packages/billing/src/webhooks/stripe.ts'],
    },
    { id: 'web', group: null, files: ['apps/web/src/page.tsx'] },
  ]);
  expect(result.invariants.map((invariant) => invariant.id)).toEqual(['paid-plans']);
});

test('a path that no root owns is unmapped, and a file root owns only that file', async () => {
  const result = await inRepo(registry, (root) =>
    classify(root, ['README.md', 'packages/billingx/a.ts', 'tools/web.tsx', 'tools/web.ts']),
  );
  expect(result.unmapped).toEqual(['README.md', 'packages/billingx/a.ts', 'tools/web.tsx']);
  expect(result.touched).toEqual([{ id: 'web', group: null, files: ['tools/web.ts'] }]);
});

test('a missing registry names the fix', async () => {
  await expect(inRepo({}, (root) => classify(root, ['a.ts']))).rejects.toThrow(
    'Restore it from the project template.',
  );
});
