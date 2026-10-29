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
  '**/apps/web/**/*.{ts,tsx}',
  '**/features/**/*.{ts,tsx}',
  '**/packages/*/ui/**/*.{ts,tsx}',
];
/** Client code that is plain TypeScript: models and the client half of commands. */
const portable = ['**/packages/*/models/**/*.ts', '**/packages/*/commands/**/*.ts'];

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
        'Client code imports schema types only (`import type`). A value that UI needs, such as a limit, lives in plain TypeScript in `models/`, and `types/` builds its schema from it. See docs/contributing/architecture/client-performance.md.',
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
  ],
  jsPlugins: [
    // Only the rules turned on below. The rest of the anti-slop preset stays off.
    ...(antiSlop.jsPlugins ?? []),
    { name: 'repo-imports', specifier: './tools/lint/import-policy.mjs' },
    { name: 'repo-classes', specifier: './tools/lint/class-policy.mjs' },
    { name: 'repo-gates', specifier: './tools/lint/gate-policy.mjs' },
    { name: 'repo-effect', specifier: './tools/lint/effect-policy.mjs' },
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

    'repo-effect/run-at-edges': 'error',
    'repo-effect/tagged-errors': 'error',
    'repo-effect/no-react-effects': 'error',

    'repo-classes/no-arbitrary-values': 'error',
    'repo-classes/speed-tokens-only': 'error',
    'repo-classes/no-transition-all': 'error',
    'repo-classes/no-dark-variant': 'error',
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
        'no-restricted-imports': ['error', noEffectValues],
        'no-restricted-globals': ['error', ...networkGlobals],
        'no-restricted-properties': ['error', ...networkProperties],
      },
    },
    {
      // Models and the client half of commands run on the client too.
      files: portable,
      rules: {
        'no-restricted-imports': ['error', noEffectValues],
        'no-restricted-globals': ['error', ...networkGlobals],
        'no-restricted-properties': ['error', ...networkProperties],
      },
    },
    {
      // The server half of a command runs on the server.
      files: ['**/packages/*/commands/**/*.server.ts'],
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
      // The design system's Button is the one place that renders `<button>`.
      // It forwards `type` and defaults it to `button`. The rule cannot read a
      // forwarded value, and each caller still passes a literal.
      files: ['**/packages/design-system/ui/button.tsx'],
      plugins: react.plugins,
      rules: { 'react/button-has-type': 'off' },
    },
    {
      // A type assertion tells the compiler to trust a value, so a wrong
      // shape gets through. Product code narrows instead: a schema at the
      // boundary, a model's or command's field shape in the object pool, or a
      // typed source. See docs/contributing/setup/lint-rules.md#escape-hatches.
      files: [
        '**/apps/web/**/*.{ts,tsx}',
        '**/apps/api/**/*.{ts,tsx}',
        '**/features/*/**/*.{ts,tsx}',
        '**/packages/*/**/*.{ts,tsx}',
      ],
      rules: { 'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }] },
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
              '/notes': { gate: 'features/notes/gate.ts', routes: 'apps/web/src/routes/notes' },
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
      ],
      rules: { 'import/no-default-export': 'off' },
    },
    {
      // TanStack Router registers its router by module augmentation, which
      // needs an `interface`.
      files: ['**/apps/web/src/router.ts'],
      rules: { 'typescript/consistent-type-definitions': 'off' },
    },
    {
      // The Workers runtime loads a worker entry through its default export.
      files: ['apps/*/src/worker.ts'],
      rules: { 'import/no-default-export': 'off' },
    },
  ],
});
