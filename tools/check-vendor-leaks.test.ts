import { expect, test } from 'bun:test';

import { findVendorLeaks } from '@tools/check-vendor-leaks';
import { registryFile } from '@tools/lint/import-policy.mjs';
import { inRepo } from '@tools/testing/in-repo';
import { fixtureRegistryYaml } from '@tools/testing/lint-imports';

const product = JSON.stringify({ nx: { tags: ['type:package'] } });
const tool = JSON.stringify({ nx: { tags: ['type:tool'] } });

test('a public declaration that shows a vendor type fails, through an import or an inferred type', async () => {
  expect(
    await inRepo(
      {
        [registryFile]: fixtureRegistryYaml,
        'packages/billing/package.json': product,
        'packages/billing/service/charge.ts': '',
        'packages/billing/out-tsc/lib/service/charge.d.ts':
          'import type Stripe from "stripe";\nexport declare function charge(): Promise<Stripe.Charge>;\n',
        'packages/billing/ui/plan.tsx': '',
        'packages/billing/out-tsc/lib/ui/plan.d.ts':
          'export declare const plan: import("stripe").Stripe.Plan;\n',
      },
      findVendorLeaks,
    ),
  ).toEqual([
    "packages/billing/service/charge.ts: its public types show Stripe (`stripe`). Give the export a type of this package's own in `types/`, and keep the vendor type in `config/`, `repo/` or `runtime/`.",
    "packages/billing/ui/plan.tsx: its public types show Stripe (`stripe`). Give the export a type of this package's own in `types/`, and keep the vendor type in `config/`, `repo/` or `runtime/`.",
  ]);
});

test('private sections, tool packages and our own types pass', async () => {
  expect(
    await inRepo(
      {
        [registryFile]: fixtureRegistryYaml,
        'packages/billing/package.json': product,
        'packages/billing/out-tsc/lib/repo/stripe.d.ts': 'import type Stripe from "stripe";\n',
        'packages/billing/out-tsc/lib/service/charge.d.ts':
          'import type { Charge } from "@repo/billing/types/charge";\nimport type { Effect } from "effect";\nexport declare function charge(): Effect.Effect<Charge>;\n',
        'packages/runtime/package.json': tool,
        'packages/runtime/out-tsc/lib/service/queue.d.ts': 'import type Stripe from "stripe";\n',
      },
      findVendorLeaks,
    ),
  ).toEqual([]);
});
