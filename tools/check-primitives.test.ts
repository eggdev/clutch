import { expect, test } from 'bun:test';

import { checkPrimitives } from '@tools/check-primitives';
import { inRepo } from '@tools/testing/in-repo';

const file = 'docs/contributing/architecture/primitives.yaml';

const valid = `
version: 1
groups:
  - id: platform
    name: Platform
primitives:
  - id: billing
    group: platform
    name: Billing
    kind: service
    summary: Charges a team for its plan.
    code: [packages/billing/]
    docs: [docs/billing.md]
    vendors:
      - vendor: Stripe
        imports: ^stripe(?:/|$)
  - id: web
    group: platform
    name: Web app
    kind: app
    summary: The browser app.
    code: [apps/web/]
    docs: []
languages:
  - imports: ^drizzle-orm(?:/|$)
    where: the billing service
    primitives: [billing]
invariants:
  - id: paid-plans
    summary: A team pays before it uses a paid feature.
    docs: [docs/intent.md#hard-invariants]
`;

const projects = {
  'packages/billing/package.json': '{}',
  'apps/web/package.json': '{}',
  'apps/notes/README.md': '',
  'docs/billing.md': '',
  'docs/intent.md': '',
};

test('a registry with known groups, real paths and an owner for each Nx project passes', async () => {
  expect(await inRepo({ ...projects, [file]: valid }, checkPrimitives)).toEqual([]);
});

test('the check names each broken entry with its fix', async () => {
  const broken = `
version: 1
groups:
  - id: platform
    name: Platform
primitives:
  - id: billing
    group: platform
    name: Billing
    kind: domain
    summary: |
      Charges a team.
      Sends invoices.
    code: [packages/billing/, packages/gone/]
    docs: [docs/missing.md]
    vendors:
      - vendor: Stripe
        imports: ^stripe(?:/|$)
  - id: billing
    group: money
    name: Billing again
    kind: widget
    summary: ${'x'.repeat(121)}
    code: [packages/billing/]
    docs: []
languages:
  - imports: ^drizzle-orm(?:/|$)
    where: the storage service
    primitives: [storage]
invariants:
  - id: paid-plans
    summary: A team pays before it uses a paid feature.
    docs: []
exceptions:
  - rule: vendor-owner
    file: legacy\\.ts$
    imports: ^stripe$
    reason: ' '
`;
  expect(await inRepo({ ...projects, [file]: broken }, checkPrimitives)).toEqual([
    `${file} exceptions[0]: \`reason\` must say why the import cannot move behind a boundary. See docs/contributing/import-boundaries.md#exceptions.`,
    `${file}: primitive \`billing\` appears more than once. Give each entry its own id.`,
    `${file}: primitive \`billing\` has a \`summary\` over one line. Keep one line, and move the detail into its docs.`,
    `${file}: primitive \`billing\` names \`packages/gone/\`, which does not exist. Fix the path, or remove it.`,
    `${file}: primitive \`billing\` names \`docs/missing.md\`, which does not exist. Fix the path, or remove it.`,
    `${file}: primitive \`billing\` lists vendors, but only a service owns a vendor. Move each vendor into a service.`,
    `${file}: primitive \`billing\` names the unknown group \`money\`. Add it under \`groups\`, or use one there.`,
    `${file}: primitive \`billing\` has the kind \`widget\`. Use one of service, domain, app, tool.`,
    `${file}: primitive \`billing\` has a \`summary\` of 121 characters. Keep it at 120 or less, and move the detail into its docs.`,
    `${file}: languages[0] names the unknown primitive \`storage\`. Use an id under \`primitives\`.`,
    `${file}: invariant \`paid-plans\` has no \`docs\`. Link the page that states it, such as docs/contributing/project-intent.md#hard-invariants.`,
    `${file}: no primitive owns the Nx project \`apps/web/\`. Add a primitive with \`apps/web/\` in its \`code\`.`,
  ]);
});

test('the old `layers` key fails with the rename', async () => {
  const old = valid.replace(/^languages:$/mu, 'layers:');
  expect(await inRepo({ ...projects, [file]: old }, checkPrimitives)).toEqual([
    `${file}: \`layers\` is the old name of \`languages\`. Rename the key. In Effect code, "Layer" means an Effect Layer only.`,
  ]);
});

test('a missing registry fails with the fix', async () => {
  expect(await inRepo(projects, checkPrimitives)).toEqual([
    `${file}: the file is missing. Restore it from the project template.`,
  ]);
});
