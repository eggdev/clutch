import { defineConfig } from 'oxlint';
import antiSlop from 'ultracite/oxlint/anti-slop';
import core from 'ultracite/oxlint/core';
import react from 'ultracite/oxlint/react';

/**
 * Client code: what runs in the browser or on a device. The React preset,
 * the network ban and the Effect import ban apply here. See
 * docs/contributing/import-boundaries.md#client-code.
 */
const client = [
  '**/apps/app/**/*.{ts,tsx}',
  // This config ships to each project, and a project may name its client app apps/web.
  '**/apps/web/**/*.{ts,tsx}',
  '**/features/**/*.{ts,tsx}',
  '**/packages/*/ui/**/*.{ts,tsx}',
];
/** Client code that is plain TypeScript: the contract and the local change of each command. */
const portable = ['**/packages/*/contract/**/*.ts', '**/packages/*/commands/**/*.ts'];

/** Effects belong to the sync hooks. Everything else derives in render or runs in a handler. */
const effectHooks = {
  name: 'react',
  importNames: ['useEffect', 'useLayoutEffect', 'useInsertionEffect'],
  message:
    'Do not use an effect. Derive the value in render, run the work in an event handler, or read records with the sync hooks (useRecords, useCommand). See docs/principles/local-first.md.',
};
/** The first screen holds no Effect code. Type imports are erased, so they stay allowed. */
const noEffectValues = {
  paths: [
    effectHooks,
    {
      name: 'effect',
      allowTypeImports: true,
      message:
        'Client code imports Effect types only (`import type`). Effect code loads after the first paint, in the sync transport. See docs/contributing/architecture/client-performance.md.',
    },
  ],
  patterns: [
    {
      group: ['effect/*', '@repo/*/types/*'],
      allowTypeImports: true,
      message:
        'Client code imports schema types only (`import type`). A value that UI needs, such as a limit, lives in plain TypeScript in `contract/`, and `types/` builds its schema from it. See docs/contributing/architecture/client-performance.md.',
    },
  ],
};
/** Only the sync engine talks to the network or stores data on the device. */
const networkMessage =
  'Only the sync engine (`packages/sync`) uses the network or device storage. Read records from the object pool and run a command. See docs/principles/local-first.md.';
const networkGlobals = [
  'fetch',
  'WebSocket',
  'XMLHttpRequest',
  'EventSource',
  'indexedDB',
  'localStorage',
  'sessionStorage',
].map((name) => ({ name, message: networkMessage }));
const networkProperties = [
  ...['window', 'globalThis', 'self'].flatMap((object) =>
    [
      'fetch',
      'WebSocket',
      'XMLHttpRequest',
      'EventSource',
      'indexedDB',
      'localStorage',
      'sessionStorage',
    ].map((property) => ({ object, property, message: networkMessage })),
  ),
  { object: 'navigator', property: 'sendBeacon', message: networkMessage },
];

/**
 * The lint baseline. Ultracite's core preset turns on most rules. This file
 * holds each choice that differs from it, with the reason, and the repository
 * import policy. See docs/contributing/setup/lint-rules.md.
 */
export default defineConfig({
  extends: [core],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    '.agents/**',
    '.claude/**',
    '.codex/**',
    '.cursor/**',
    // `one generate-routes` writes this file, and its own disable comment is not ours.
    'apps/app/app/routes.d.ts',
  ],
  jsPlugins: [
    // Only the rules turned on below. The rest of the anti-slop preset stays off.
    ...(antiSlop.jsPlugins ?? []),
    { name: 'repo-imports', specifier: './tools/lint/import-policy.mjs' },
    { name: 'repo-classes', specifier: './tools/lint/class-policy.mjs' },
    { name: 'repo-gates', specifier: './tools/lint/gate-policy.mjs' },
    { name: 'repo-effect', specifier: './tools/lint/effect-policy.mjs' },
    { name: 'repo-tests', specifier: './tools/lint/test-policy.mjs' },
    { name: 'repo-components', specifier: './tools/lint/component-policy.mjs' },
    { name: 'repo-determinism', specifier: './tools/lint/determinism-policy.mjs' },
    { name: 'repo-layout', specifier: './tools/lint/layout-policy.mjs' },
  ],
  rules: {
    // Function declarations read as the module's API and hoist. Arrow
    // functions stay fine for callbacks and short helpers.
    'func-style': ['error', 'declaration', { allowArrowFunctions: true }],
    // `Array<T>` reads the same way as every other generic type.
    'typescript/array-type': ['error', { default: 'generic' }],
    // One way to name a shape. `type` covers unions and mapped types too.
    'typescript/consistent-type-definitions': ['error', 'type'],
    // Named exports keep one name for a thing across the codebase. Config
    // files that a tool loads by default export are listed in `overrides`.
    'import/no-default-export': 'error',
    // Key order often carries meaning: route tables, config steps, state
    // machine order. Alphabetical order throws that away.
    'sort-keys': 'off',
    // Sequential awaits are often required: migrations, rate limits, ordered
    // steps. Suppression comments are not allowed, so the rule cannot hold.
    'no-await-in-loop': 'off',
    // Wrapping a callback API needs `new Promise`.
    'promise/avoid-new': 'off',
    // A `never` check in a switch catches a missing case. A `default` hides it.
    'default-case': 'off',
    // Names make a short regex longer for no gain.
    'prefer-named-capture-group': 'off',
    // No bug value: the formatter adds semicolons.
    'no-plusplus': 'off',
    // Hashing and encoding code uses bit operations on purpose.
    'no-bitwise': 'off',
    // `unicorn/no-negated-condition` covers this and fixes it.
    'no-negated-condition': 'off',
    // `import/no-duplicates` covers this and fixes it.
    'no-duplicate-imports': 'off',
    // Effect code passes anonymous generators to `Effect.gen`. A name on each
    // one adds noise and no stack trace detail, so generators may stay anonymous.
    'func-names': ['error', 'always', { generators: 'never' }],
    // Effect Schema declares a value and a type with one name, such as `Note`.
    // The base rule reads that as a redeclaration. TypeScript reports a real
    // redeclaration (TS2451), so this rule adds nothing.
    'no-redeclare': 'off',
    // Effect builds error classes with calls such as `Schema.TaggedError<E>()`.
    // The rule reads each call to a name that ends in `Error` as a missing `new`.
    // TypeScript checks what a `throw` throws.
    'unicorn/throw-new-error': 'off',
    // Destructure objects. `items[0]` reads better than `const [item] = items`.
    'prefer-destructuring': ['error', { object: true, array: false }],
    // `x as unknown as T` and widen-then-assert are casts that skip the type
    // check. Decode a value from outside the program with a schema instead.
    'anti-slop/no-chained-type-assertions': 'error',
    'anti-slop/no-widen-then-assert': 'error',

    'repo-imports/aliases-only': 'error',
    'repo-imports/tier-direction': 'error',
    'repo-imports/feature-isolation': 'error',
    'repo-imports/section-access': 'error',
    'repo-imports/server-only': 'error',
    'repo-imports/no-cycles': 'error',
    'repo-imports/vendor-owner': 'error',
    'repo-imports/languages': 'error',
    'repo-imports/testing-imports': 'error',
    'repo-imports/no-internal-mocks': 'error',
    'repo-imports/no-reexports': 'error',

    // Effects belong to the sync hooks. The client overrides below add the
    // Effect import ban to this list.
    'no-restricted-imports': ['error', { paths: [effectHooks] }],

    // Only the object pool reads the clock and makes IDs on the client, so a
    // test or a driver that pins them gets the same records on every run.
    // The rule itself names the client code that it covers.
    'repo-determinism/no-ambient-time': 'error',

    'repo-effect/run-at-edges': 'error',
    'repo-effect/tagged-errors': 'error',
    'repo-effect/no-react-effects': 'error',

    'repo-classes/no-arbitrary-values': 'error',
    'repo-classes/speed-tokens-only': 'error',
    'repo-classes/no-transition-all': 'error',
    'repo-classes/no-dark-variant': 'error',

    // Product code renders the design system's components, not the raw
    // elements that they wrap. The design system and tests are exempt. See
    // docs/contributing/setup/lint-rules.md#design-system-components.
    'repo-components/design-system-only': 'error',
  },
  overrides: [
    {
      // Client code: React rules, no Effect values, no network and no device storage.
      files: client,
      plugins: react.plugins,
      rules: {
        ...react.rules,
        // A component is a function declaration, like every other function
        // here (`func-style`). One way to write a component.
        'react/function-component-definition': [
          'error',
          { namedComponents: 'function-declaration', unnamedComponents: 'arrow-function' },
        ],
        // React Native has no DOM tags, so a component names its role with `role`. This rule asks for DOM tags, and oxlint checks custom components too, so each correct role would fail. The other jsx-a11y rules stay on: they check `aria-*` props, which React Native supports.
        'jsx-a11y/prefer-tag-over-role': 'off',
        'no-restricted-imports': ['error', noEffectValues],
        'no-restricted-globals': ['error', ...networkGlobals],
        'no-restricted-properties': ['error', ...networkProperties],
        // A component responds to its container. Only the app shell, the root
        // layout, reads the window width. See docs/principles/mobile-first.md.
        'repo-layout/no-viewport-reads': ['error', { shell: ['apps/app/app/_layout+ssg.tsx'] }],
      },
    },
    {
      // The contract and the local change of each command run on the client too.
      files: portable,
      rules: {
        'no-restricted-imports': ['error', noEffectValues],
        'no-restricted-globals': ['error', ...networkGlobals],
        'no-restricted-properties': ['error', ...networkProperties],
      },
    },
    {
      // The server half of a command runs on the server.
      files: ['**/packages/*/commands/**/*.server.ts', '**/packages/*/contract/**/*.server.ts'],
      rules: {
        'no-restricted-imports': ['error', { paths: [effectHooks] }],
        'no-restricted-globals': 'error',
        'no-restricted-properties': 'off',
      },
    },
    {
      // The sync engine owns the network, the device storage and the effects
      // that subscribe to them. Its UI still imports Effect types only.
      files: ['**/packages/sync/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-globals': 'error',
        'no-restricted-properties': 'off',
      },
    },
    {
      files: ['**/packages/sync/ui/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          { paths: noEffectValues.paths.slice(1), patterns: noEffectValues.patterns },
        ],
      },
    },
    {
      // The design system's Button is the one place that renders `<button>`
      // (`repo-components/design-system-only`). It forwards `type` and
      // defaults it to `button`. The rule cannot read a forwarded value, and
      // each caller still passes a literal.
      files: ['**/packages/design-system/ui/button.tsx'],
      plugins: react.plugins,
      rules: { 'react/button-has-type': 'off' },
    },
    {
      // A type assertion tells the compiler to trust a value, so a wrong
      // shape gets through. Product code narrows instead: a schema at the
      // boundary, the fields of a record or a command in the object pool, or
      // a typed source. See docs/contributing/setup/lint-rules.md#escape-hatches.
      files: [
        '**/apps/api/**/*.{ts,tsx}',
        '**/apps/app/**/*.{ts,tsx}',
        // A project may name its client app apps/web. See the `client` list above.
        '**/apps/web/**/*.{ts,tsx}',
        '**/features/*/**/*.{ts,tsx}',
        '**/packages/*/**/*.{ts,tsx}',
      ],
      rules: { 'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }] },
    },
    {
      // A test proves behavior that a user or a caller sees: it runs every
      // time, asserts a value, and does not only snapshot an output or check
      // that something exists. See docs/contributing/testing.md#test-rules.
      files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/*.pw.ts', '**/*.journey.ts'],
      rules: {
        'repo-tests/no-hidden-tests': 'error',
        'repo-tests/no-snapshots': 'error',
        'repo-tests/assert-behavior': 'error',
      },
    },
    {
      // A repo maps database rows to records, and a test builds what it
      // needs, so both may assert a type.
      files: [
        '**/packages/*/repo/**/*.ts',
        '**/packages/*/testing/**/*.{ts,tsx}',
        '**/*.test.{ts,tsx}',
        '**/*.pw.ts',
      ],
      rules: { 'typescript/consistent-type-assertions': 'off' },
    },
    {
      // Tests run on the server and may use Effect to run Test Layers. The
      // effect-hook ban still holds.
      files: ['**/*.test.{ts,tsx}'],
      rules: {
        'no-restricted-imports': ['error', { paths: [effectHooks] }],
        'no-restricted-globals': 'error',
        'no-restricted-properties': 'off',
      },
    },
    {
      // One gate into each feature. In app code, a gated route opens only
      // through its gate, which settles permissions and data before the first
      // render. Tests may open a route directly to prove a cold deep link.
      // Add a route here when its gate exists. See
      // docs/principles/one-gate-per-feature.md.
      files: ['apps/*/**/*.{ts,tsx}', 'features/*/**/*.{ts,tsx}', 'packages/*/**/*.{ts,tsx}'],
      rules: {
        'repo-gates/one-gate': [
          'error',
          {
            gates: {
              '/notes': { gate: 'features/notes/gate.ts', routes: 'apps/app/app/notes.tsx' },
            },
          },
        ],
      },
    },
    {
      // Tools load these files through their default export.
      files: [
        '*.config.{ts,mts,js,mjs}',
        'tools/hooks/paths.mjs',
        'tools/lint/import-policy.mjs',
        'tools/lint/class-policy.mjs',
        'tools/lint/gate-policy.mjs',
        'tools/lint/effect-policy.mjs',
        'tools/lint/test-policy.mjs',
        'tools/lint/component-policy.mjs',
        'tools/lint/determinism-policy.mjs',
        'tools/lint/layout-policy.mjs',
      ],
      rules: { 'import/no-default-export': 'off' },
    },
    {
      // One loads each route file through its default export, so the screens of
      // apps/app keep one for their component. Other files stay named.
      files: ['**/apps/*/app/**/*.{ts,tsx}'],
      rules: { 'import/no-default-export': 'off' },
    },
    {
      // Hermes lacks the ES2023 array methods that return a copy. This file adds each missing one to the prototype, from the method that changes the array.
      files: ['apps/app/lib/hermes.native.ts'],
      rules: { 'no-extend-native': 'off', 'unicorn/no-array-sort': 'off' },
    },
    {
      // The Workers runtime loads a worker entry through its default export.
      files: ['apps/*/src/worker.ts'],
      rules: { 'import/no-default-export': 'off' },
    },
  ],
});
