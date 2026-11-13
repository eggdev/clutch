# Engineering principles

Short, durable rules for how we build. Each page is one principle. Open only
the page the task needs. Read [project intent](../contributing/project-intent.md)
first for product decisions.

These pages are the same in every project that starts from the template. A page
here never states a fact about one product. It links to the project page that
owns the fact.

The `Held by` column names the check, lint rule or test that holds each
principle. A note in brackets says when it holds only part of the principle.
`Review only` means that no check holds the principle yet, and
[review](../contributing/review.md#principles-that-no-check-holds) holds its
rule. `check-docs-claims` keeps this column true: each principle page needs a
row, and each name in a cell must exist.

## Speed

Speed drives the design of every surface that a person uses. A user action
never waits on the network, and the web app renders in the browser. Open these pages first for any change to what a
user sees or does.

| Principle                                             | When to open it                                                       | Held by                                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [Single-page app](./single-page-app.md)               | Adding a route, a render mode, a server render or a web host          | `check-structure` (only that each server render names its reason)                                                    |
| [Local first](./local-first.md)                       | Adding a screen, a read, a write, a search or a boot step             | `no-restricted-globals` (only network calls in client code)                                                          |
| [Stay at 60 FPS](./stay-at-60-fps.md)                 | Adding a page, a guard, a data load, or work that runs on navigation  | `features/notes/screens/notes-screen.test.tsx` (only no request before a warm paint; no frame-budget journey yet)    |
| [Fast first load](./fast-first-load.md)               | Adding a dependency, a route, a font or a step before the first paint | `check-bundle`                                                                                                       |
| [Compositor-only motion](./compositor-only-motion.md) | Adding a transition, an animation or a duration                       | `plugin/no-low-performance-animation-properties`, `repo-classes/no-transition-all`, `repo-classes/speed-tokens-only` |
| [Keyboard first](./keyboard-first.md)                 | Adding an action, a menu item or a navigation target                  | Review only                                                                                                          |

## Interface

Each surface starts on a phone and takes every visual value from a token.

| Principle                                           | When to open it                                               | Held by                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Mobile first](./mobile-first.md)                   | Adding a screen, a component, a breakpoint or a fixed width   | `repo-layout/no-viewport-reads` (only a window width read outside the app shell)                                                                   |
| [Tokens for every visual value](./design-tokens.md) | Adding a color, a size, a radius, a shadow, a font or a theme | `repo-classes/no-arbitrary-values`, `repo-classes/no-dark-variant`, `repo-classes/speed-tokens-only`, `declaration-property-value-disallowed-list` |

## Everything else

| Principle                                                                   | When to open it                                                                               | Held by                                                                                     |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Proof gates code](./proof-gates-code.md)                                   | Asking the owner, changing a sensitive path, or adding a journey or a gate                    | `check-journeys`, `tools/github/weaker-journeys.ts` (in the merge judge)                    |
| [Generic platform](./generic-platform.md)                                   | Importing a vendor, adding a module, or deciding which module owns a vendor                   | `repo-imports/vendor-owner`, `check-vendor-leaks`                                           |
| [Normalized source of truth](./normalized-source-of-truth.md)               | Adding a cache, index or second store for a fact that already has a record                    | `repo-imports/section-access` (only reads of another package's private sections)            |
| [Delete what is off the common path](./delete-off-the-common-path.md)       | A migration left an old lane, or a branch, field, flag or doc serves a path the product skips | `knip` (only unused files, exports and dependencies)                                        |
| [Fail loudly in the right module](./fail-loudly.md)                         | An error could be swallowed so a partial result continues                                     | `no-empty` (only an empty catch block), `repo-effect/tagged-errors` (only package services) |
| [Fix the root bottleneck](./fix-the-root-bottleneck.md)                     | Masking slowness with timeouts, fallbacks or caches                                           | Review only                                                                                 |
| [One door for each decision](./one-door-for-each-decision.md)               | Adding a route, job or tool that touches access, money or visibility, or a new kind of guard  | `typecheck` (only the required access field of each sync command)                           |
| [One gate into each feature](./one-gate-per-feature.md)                     | Adding a way into a feature, or a check that a feature needs before its first screen          | `repo-gates/one-gate`, `check-structure`                                                    |
| [Two-way and one-way doors](./two-way-doors.md)                             | Changing a stored shape, a hard invariant, or anything a copy outlives                        | `check-contract`, `check-migrations` (only the contract and migrations)                     |
| [Older copies always recover](./older-copies-recover.md)                    | Changing a server rule, a refusal, a retry, a queue, a cache or a stored shape                | `check-contract`, `check-migrations` (only the contract and migrations)                     |
| [Examples over prose](./examples-over-prose.md)                             | Writing docs, skills or a procedure with more than one step                                   | `check-docs-file-refs` (only that cited paths exist)                                        |
| [Keep agent context lean](./lean-agent-context.md)                          | Editing `AGENTS.md` or skills, or deciding where guidance goes                                | `check-file-size` (only the line budget of each AGENTS.md file)                             |
| [No invasive test-only code in production](./no-invasive-test-only-code.md) | Adding test seams, test-only exports, env branches or fixture entrypoints                     | `repo-imports/testing-imports` (only production imports of testing folders)                 |
| [Test the workflow](./test-the-workflow.md)                                 | Adding or changing tests, fakes or end-to-end journeys                                        | `repo-imports/no-internal-mocks`, `repo-tests/no-hidden-tests`                              |

Related maps: [contributing index](../contributing/index.md),
[decision records](../contributing/decisions/index.md),
[harness engineering](../contributing/harness-engineering.md).
