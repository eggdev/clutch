import { defineConfig } from 'oxlint';
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
    { name: 'repo-imports', specifier: './tools/lint/import-policy.mjs' },
    { name: 'repo-classes', specifier: './tools/lint/class-policy.mjs' },
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
    // Destructure objects. `items[0]` reads better than `const [item] = items`.
    'prefer-destructuring': ['error', { object: true, array: false }],

    'repo-imports/aliases-only': 'error',
    'repo-imports/module-dependencies': 'error',
    'repo-imports/module-direction': 'error',
    'repo-imports/no-cycles': 'error',
    'repo-imports/vendor-owner': 'error',
    'repo-imports/layers': 'error',
    'repo-imports/testing-imports': 'error',
    'repo-imports/no-internal-mocks': 'error',

    'repo-classes/no-arbitrary-values': 'error',
    'repo-classes/speed-tokens-only': 'error',
    'repo-classes/no-transition-all': 'error',
    'repo-classes/no-dark-variant': 'error',
  },
  overrides: [
    {
      // Tools load these files through their default export.
      files: [
        '*.config.{ts,mts,js,mjs}',
        'tools/hooks/paths.mjs',
        'tools/lint/import-policy.mjs',
        'tools/lint/class-policy.mjs',
      ],
      rules: { 'import/no-default-export': 'off' },
    },
    {
      // The Workers runtime loads a worker entry through its default export.
      files: ['apps/*/src/worker.ts'],
      rules: { 'import/no-default-export': 'off' },
    },
  ],
});
