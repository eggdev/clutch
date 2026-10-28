import { defineConfig } from 'oxlint';
import antiSlop from 'ultracite/oxlint/anti-slop';
import core from 'ultracite/oxlint/core';

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

    'repo-classes/no-arbitrary-values': 'error',
    'repo-classes/speed-tokens-only': 'error',
    'repo-classes/no-transition-all': 'error',
    'repo-classes/no-dark-variant': 'error',
  },
  overrides: [
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
      ],
      rules: { 'import/no-default-export': 'off' },
    },
    {
      // TanStack Router registers its router by module augmentation, which
      // needs an `interface`.
      files: ['apps/web/src/router.ts'],
      rules: { 'typescript/consistent-type-definitions': 'off' },
    },
    {
      // The Workers runtime loads a worker entry through its default export.
      files: ['apps/*/src/worker.ts'],
      rules: { 'import/no-default-export': 'off' },
    },
  ],
});
