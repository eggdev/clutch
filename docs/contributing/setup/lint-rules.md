# Lint and format rules

[`oxlint.config.ts`](../../../oxlint.config.ts) holds the lint baseline. It
extends the `core` preset of [Ultracite](https://github.com/haydenbleasel/ultracite),
adds the Ultracite React preset for [client code](#client-code), and then
states each choice that differs from them. The repository import policy
is in the same file. See [import boundaries](../import-boundaries.md).

## How a rule is chosen

1. **Ultracite is the base.** Its `core` preset turns on about 470 rules. The
   version is pinned in `package.json`.
2. **Decide a rule when it fires.** A rule that raises no error costs nothing,
   so it stays as Ultracite sets it. When a rule fires on real code, keep it,
   turn it off or set its options. Write the choice in `oxlint.config.ts` with
   a comment that gives the reason.
3. **No suppression comments.** A rule is on everywhere or off everywhere. A
   rule with legitimate exceptions is configured or turned off, with the
   reason. It is never silenced in one file. The `check-suppressions` target
   rejects each lint and type suppression comment, `@ts-expect-error` too.
4. **An Ultracite upgrade is a reviewed change.** Read the preset diff. Run the
   lint, and decide each new rule that fires, as in step 2.

## Choices

The comments in `oxlint.config.ts` are the record. In short:

| Kind          | Rules                                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Style         | Function declarations, `Array<T>`, `type` over `interface`, named exports                                                                                                         |
| Off           | `sort-keys`, `no-await-in-loop`, `promise/avoid-new`, `default-case`, `prefer-named-capture-group`, `no-plusplus`, `no-bitwise`, and two rules that another rule already covers   |
| Configured    | `prefer-destructuring` for objects only                                                                                                                                           |
| Added         | `anti-slop/no-chained-type-assertions` and `anti-slop/no-widen-then-assert` from Ultracite's anti-slop plugin. They reject `x as unknown as T`. The rest of that preset stays off |
| Default files | Config files, lint plugins and Worker entries (`apps/*/src/worker.ts`) that a tool loads by default export may use one                                                            |

`typescript/no-explicit-any` and `no-warning-comments` come from the preset. A
marker comment such as FIXME or HACK fails lint. Record the work in an issue.

## CSS

Stylelint lints each `.css` file. [`stylelint.config.ts`](../../../stylelint.config.ts)
enforces [compositor-only motion](../../principles/compositor-only-motion.md).
`tools/lint/stylelint-config.test.ts` proves each rule with CSS that passes and
CSS that fails.

| Rule                                             | Rejects                                                        |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `plugin/no-low-performance-animation-properties` | A transition or keyframe on a layout property, or on `all`     |
| `declaration-property-value-disallowed-list`     | A duration literal in `transition` or `animation`. Use a token |
| `declaration-property-value-allowed-list`        | A `--speed-*` token longer than 350 ms                         |

The plugin allows four paint properties for short hover and focus changes:
`color`, `background-color`, `border-color` and `fill`.

## Tailwind classes

Stylelint does not read class names in TSX. The `repo-classes` oxlint plugin is
[`tools/lint/class-policy.mjs`](../../../tools/lint/class-policy.mjs). It reads
the strings in `className` and `class` attributes. It also reads the strings in
calls to `cn`, `clsx`, `cx`, `cva`, `tv`, `twMerge` and `twJoin`. It enforces
[tokens for every visual value](../../principles/design-tokens.md) and
[compositor-only motion](../../principles/compositor-only-motion.md).
`tools/lint/class-policy.test.ts` proves each rule with classes that pass and
classes that fail.

| Rule                  | Rejects                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `no-arbitrary-values` | A value in brackets, such as `bg-[#fff]`, `p-[13px]` or `[mask-type:luminance]` |
| `speed-tokens-only`   | A duration or delay that is not a speed token, such as `duration-300`           |
| `no-transition-all`   | `transition-all`                                                                |
| `no-dark-variant`     | The `dark:` variant                                                             |

Brackets in a variant select an element and stay allowed, such as
`data-[state=open]:` and `[&>svg]:`. A duration reads its token through the
variable shorthand: `duration-(--speed-quick)`.

## Feature gates

The `repo-gates` oxlint plugin,
[`tools/lint/gate-policy.mjs`](../../../tools/lint/gate-policy.mjs), enforces
[one gate into each feature](../../principles/one-gate-per-feature.md). The
rule option in `oxlint.config.ts` is the registry. It maps each gated route to
its gate file and its route folder. The template registers `/notes`, with
`features/notes/gate.ts`. The `feature` generator adds each new route. The rule
applies to `apps/`, `features/` and `packages/`.

| Rule       | Rejects                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `one-gate` | A gated route in a navigation call (`push`, `replace`, `navigate`, `redirect`) or in an `href`, outside its gate and route folder |

A string that does not navigate, such as an analytics screen name, passes.
Tests may open a gated route directly to prove a cold deep link.

To gate a new feature:

1. Run the `feature` generator. It writes the gate and the route, and adds the
   route to the registry.
2. Write the gate: one function that settles the feature's needs, then
   navigates.
3. Change every way in to call the gate. Run the lint.

`tools/lint/gate-policy.test.ts` proves that a second way in fails and that a
name that does not navigate passes.

## Client code

Client code runs in the browser or on a device. It is `apps/web`, `features/`
and the `ui/` of each package. The `models/` and `commands/` of a package run
there too. `oxlint.config.ts` applies these rules to client code:

| Rule                                                   | Rejects                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| The Ultracite React preset                             | React mistakes, with the React Compiler rules as errors. A component is a function declaration                                  |
| `no-restricted-imports`                                | `useEffect`, `useLayoutEffect` and `useInsertionEffect`, in any code outside `packages/sync/ui/`                                |
| `no-restricted-imports`                                | A value import from `effect`, `effect/*` or `@repo/*/types/*`. A type import passes                                             |
| `no-restricted-globals` and `no-restricted-properties` | `fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource`, `indexedDB`, `localStorage`, `sessionStorage` and `navigator.sendBeacon` |

Only the sync engine, `packages/sync`, uses the network and device storage.
Test files may import Effect, because they run Test Layers. The effect-hook ban
holds in tests too. See [local first](../../principles/local-first.md).

## Escape hatches

A type assertion tells the compiler to trust a value, so a wrong shape gets
through. `typescript/consistent-type-assertions` rejects `as` and angle
casts in apps, features and packages. `as const` stays allowed.

- A repo mapping in `repo/`, a helper in `testing/` and a test file may
  assert a type. A repo maps database rows to records, and a test builds
  what it needs.
- Product code narrows instead. It decodes with a schema at the boundary, or
  checks a record against its model's `fields`, or types the source.
- Each other escape hatch lives in a guardrail file, so a person reviews it.
  See [guardrail files](../harness-engineering.md#guardrail-files).

## Test files

The `repo-tests` plugin in `tools/lint/test-policy.mjs` runs on each test
file. It rejects skipped and focused tests, snapshots, tests with no
assertion, and tests that only check that a value exists. See
[test rules](../testing.md#test-rules).

## Effect code

The `repo-effect` plugin,
[`tools/lint/effect-policy.mjs`](../../../tools/lint/effect-policy.mjs), has
three rules. `tools/lint/client-rules.test.ts` proves each rule with code that
passes and code that fails.

| Rule               | Rejects                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `run-at-edges`     | `Effect.runPromise` and the other run calls outside `runtime/`, an app, `tools/` or a test                               |
| `tagged-errors`    | `throw`, an `async` function or `new Promise` in `service/` and `.server.ts` files of a `type:package` package           |
| `no-react-effects` | `React.useEffect` and the other effect hooks through a default or namespace import of React, outside `packages/sync/ui/` |

A `type:tool` package, such as `packages/runtime`, is exempt from
`tagged-errors`.

## Formatting

Oxfmt formats each file. [`.oxfmtrc.json`](../../../.oxfmtrc.json) states each
setting, even where it matches the default, so a default change in an upgrade
does not reformat the repository.

| Setting           | Value      | Reason                                                           |
| ----------------- | ---------- | ---------------------------------------------------------------- |
| Quotes            | Single     | Matches the projects this template comes from                    |
| Line width        | 100        | Long type signatures and test names wrap less                    |
| Trailing commas   | `all`      | Function parameters get them too, so a new item changes one line |
| Imports           | Sorted     | Import order is never a review comment                           |
| `package.json`    | Sorted     | The same, for a file that many changes touch                     |
| Markdown wrapping | `preserve` | The formatter keeps the line breaks that a writer chose          |

## Run it

```sh
mise exec -- bun run check
mise exec -- bun x oxlint --fix <paths>
```

The pre-commit hook runs `oxlint --fix` and `stylelint --fix` on staged files. See
[Git hooks](./checks.md#git-hooks).
