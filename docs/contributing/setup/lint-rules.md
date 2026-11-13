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
   reason. It is never silenced in one file. An adopted repository may ratchet
   a rule that it turns on late: old violations stay counted per file, and the
   count may only go down. See
   [decision 0001](../decisions/0001-allow-shrink-only-ratchets.md). The `check-suppressions` target
   rejects each lint and type suppression comment, `@ts-expect-error` too. It
   reads the files that git tracks or would track, so it leaves out a folder
   that git ignores, such as a generated native project.
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

## Design-system components

Product code renders the design system's components, not the raw platform
elements that they wrap. A raw `<button>` misses the focus ring, the touch
target and the tokens that `Button` carries, and each copy drifts on its own.
The `repo-components` oxlint plugin,
[`tools/lint/component-policy.mjs`](../../../tools/lint/component-policy.mjs),
enforces it. Sentry's `preferPrimitives` and Twenty's `no-twenty-ui-override`
do the same job.

| Rule                 | Rejects                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| `design-system-only` | A raw element that `packages/design-system/ui/` exports a component for, outside of it |

`wrapped` in the plugin is the one list. It maps each raw element to the
components that replace it, best first:

| Raw element                                                                 | Component                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `<button>`, and `Pressable` and the `Touchable*` family from `react-native` | `Button`, else `IconButton`                                     |
| `<input>`, and `TextInput` from `react-native`                              | `TextField`, `Input` or `TextInput`, by `type` where one exists |
| `<textarea>`, `<select>`, `<a>`                                             | `Textarea`, `NativeSelect` or `Select`, `Link`                  |
| `Switch` and `Text` from `react-native`                                     | `Switch`, `Text`                                                |

The rule reads the design system's exports at lint time. A raw element fails
only when one of its components exists, and the message names that component
and its import path. So the template, whose design system has `Button` and
`TextField`, rejects `<button>` and `<input>`. A project with a `Text`
component rejects `Text` from `react-native` too. Layout elements such as
`View`, `ScrollView` and `<div>` pass. The design system itself, test files
and `testing/` folders are exempt.

A product need that no component covers is a change to the design system: add
a variant or a component there, then use it. The notes row edits its title in
place with `TextField variant="inline"`, for example.

### Ratchet a rule

A project that turns this rule on with old call sites ratchets them, as
[decision 0001](../decisions/0001-allow-shrink-only-ratchets.md) allows. The
rule skips each file that the `design-system-only` ratchet in
`.clutch/ratchets.json` counts, and `clutch ratchet check` counts those files
with [`tools/lint/lint-counts.ts`](../../../tools/lint/lint-counts.ts). That
script runs oxlint with `REPO_LINT_ALL=1`, so the skip is off, and prints
`path:count` for one rule. A count may only go down. A file whose count reaches
0 leaves the ratchet at `clutch ratchet update`, and the rule covers it again.

```sh
mise exec -- bun run clutch ratchet add design-system-only \
  --command 'bun tools/lint/lint-counts.ts repo-components/design-system-only' \
  --files '{apps,features,packages}/**/*.tsx'
```

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

Client code runs in the browser or on a device. It is `apps/app`, `features/`
and the `ui/` of each package. The `contract/` and the client `commands/` of a
package run there too. `oxlint.config.ts` applies these rules to client code.
The import and network rows also apply to `contract/` and `commands/`, through
the `portable` files in `oxlint.config.ts`:

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
  checks a record with the `is` check of its record in `contract/`, or types
  the source.
- Each other escape hatch lives in a guardrail file. Agent review gives a new
  hatch an `owner` finding, so the owner decides. See
  [guardrail files](../harness-engineering.md#guardrail-files).

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

## Determinism

The `repo-determinism` plugin,
[`tools/lint/determinism-policy.mjs`](../../../tools/lint/determinism-policy.mjs),
has one rule. [`tools/lint/determinism-policy.test.ts`](../../../tools/lint/determinism-policy.test.ts)
proves it with code that passes and code that fails.

| Rule              | Rejects                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `no-ambient-time` | `Date.now()`, `new Date()` with no argument, `Math.random()`, `crypto.randomUUID()`, `crypto.getRandomValues()` and `performance.now()` in client code |

Client code here is an app that ships to a device, a feature, and the `ui/`,
`contract/` and `commands/` of a package. The object pool in `packages/sync`,
server files, tests and `testing/` are exempt. A command declares a `now` or
`new-id` stamp in its input, and the object pool fills it. See
[local-first sync](../architecture/local-first-sync.md).

A project that takes this rule with old call sites ratchets them, as it does
for [the design-system rule](#ratchet-a-rule). The rule skips each file that
the `no-ambient-time` ratchet counts.

```sh
mise exec -- bun run clutch ratchet add no-ambient-time \
  --command 'bun tools/lint/lint-counts.ts repo-determinism/no-ambient-time' \
  --files '{apps,features,packages}/**/*.{ts,tsx}'
```

## Layout

The `repo-layout` plugin,
[`tools/lint/layout-policy.mjs`](../../../tools/lint/layout-policy.mjs), has
one rule. [`tools/lint/layout-policy.test.ts`](../../../tools/lint/layout-policy.test.ts)
proves it with code that passes and code that fails.

| Rule                | Rejects                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-viewport-reads` | `window.innerWidth`, `outerWidth`, `screen.width`, `screen.availWidth`, `matchMedia` with a width query, and `useWindowDimensions()` and `Dimensions.get()` from React Native, in client code |

A component responds to its container, so only the app shell reads the
window width. The rule's `shell` option in `oxlint.config.ts` lists the shell
files: the root layout, `apps/app/app/_layout+ssg.tsx`. Tests and `testing/`
are exempt. A query that does not read the width passes, such as
`(prefers-reduced-motion: reduce)`. A query that is not a string literal
fails, because lint cannot read it. A `matchMedia` or a window under a local
name fails too, because lint follows no local name. See
[mobile first](../../principles/mobile-first.md).

A project that takes this rule with old call sites ratchets them, as it does
for [the design-system rule](#ratchet-a-rule). The rule skips each file that
the `no-viewport-reads` ratchet counts.

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

The formatter leaves out `native-fingerprint.json`. The command `native:build`
writes that file, and it does not write the form of the formatter. Without that
entry, `format-check` fails after each native build.

## Run it

```sh
mise exec -- bun run check
mise exec -- bun x oxlint --fix <paths>
```

The pre-commit hook runs `oxlint --fix` and `stylelint --fix` on staged files. See
[Git hooks](./checks.md#git-hooks).
