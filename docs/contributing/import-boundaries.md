# Import boundaries

This page lists every import rule in the repository. Each rule names the lint
rule that enforces it. Run the lint with `mise exec -- bun run check`. Test the
policy with `mise exec -- bun nx run-many -t lint-policy-test`.

The policy is [`tools/lint/import-policy.mjs`](../../tools/lint/import-policy.mjs).
Its project data is the
[primitives registry](./architecture/primitives.yaml): the vendor owners, the
languages and the exceptions. [`oxlint.config.ts`](../../oxlint.config.ts) turns on
each rule. The policy also exports its matchers and its registry parser, so a
test can check them without a lint run.

Every rule reads each module specifier in a file. That includes static
imports, re-exports, dynamic `import()`, type imports and `require`. It also
includes the first argument of `vi.mock`, `jest.mock`, `mock.module` and their
relatives, such as `vi.importActual`. A test cannot route around a boundary with a mock.

## Tiers and sections

The [architecture page](./architecture/index.md#tiers) describes the tiers and
the package sections. Each package and feature declares its kind with an Nx tag
in its `package.json`: `type:package`, `type:tool` or `type:feature`.
[`tools/lint/check-manifests.ts`](../../tools/lint/check-manifests.ts) rejects a
package or a feature without exactly one of them.

| Rule                                                                           | Enforced by                      |
| ------------------------------------------------------------------------------ | -------------------------------- |
| A package imports only packages. A feature imports packages and its own files. | `repo-imports/tier-direction`    |
| Nothing outside an app imports `@/`                                            | `repo-imports/tier-direction`    |
| A feature never imports another feature                                        | `repo-imports/feature-isolation` |
| `config/` and `repo/` are imported only by their own package                   | `repo-imports/section-access`    |
| `runtime/` is imported only by an app, its own package or a test               | `repo-imports/section-access`    |
| A package import names a real section                                          | `repo-imports/section-access`    |
| Client code never imports server code                                          | `repo-imports/server-only`       |
| No import cycles between packages                                              | `repo-imports/no-cycles`         |

Each message names the fix. For example, `feature-isolation` says to move the
shared part into the design system or into the `ui/` of the package that owns
the records.

## Aliases

| Alias                         | Resolves to      | Use                                      |
| ----------------------------- | ---------------- | ---------------------------------------- |
| `@/…`                         | The app's `src/` | Files in the same app                    |
| `@repo/<package>/<section>/…` | `packages/…`     | A section of a package                   |
| `@features/<feature>/…`       | `features/…`     | A feature's gate or screens, from an app |
| `@tools/…`                    | `tools/…`        | Tooling                                  |

Aliases mirror file paths. Import the file you need. Packages have no barrel
files. `repo-imports/no-reexports` rejects each `export ... from`, so each
thing has one import path. Platform suffixes such as `.native` stay part of the
file name:

```ts
import { renameNote } from '@repo/notes/commands/rename-note';
```

`repo-imports/aliases-only` rejects:

- Relative module specifiers, including in re-exports, dynamic imports,
  CommonJS, type imports and test runner mocks
- A bare `@repo/<name>` or `@features/<name>` specifier
- The `@apps/` alias
- `exports` maps in workspace package manifests

Relative file system and configuration paths are not module imports. This rule
does not cover them. Each app keeps its alias table in its own
`tsconfig.json`, because tsconfig `paths` do not merge.

## Vendors and languages

| Rule                                                                                                               | Enforced by                 |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| A vendor is imported only in `config/`, `repo/`, `runtime/` or `testing/` of its owner, or in the owner's tests    | `repo-imports/vendor-owner` |
| A shared language, such as a query builder or a UI framework, is imported only in the folders that its entry names | `repo-imports/languages`    |

See [generic platform](../principles/generic-platform.md). Add a vendor or a
language to the registry in the same change that adds the dependency. A vendor
goes in the `vendors` list of its owner, which is a package:

```yaml
primitives:
  - id: billing
    group: platform
    name: Billing
    kind: package
    summary: Charges a team for its plan.
    code:
      - packages/billing/
    docs:
      - docs/contributing/architecture/billing.md
    vendors:
      - vendor: Stripe
        imports: ^stripe(?:/|$)
```

The owner of a vendor is the `packages/<name>/` folder in the `code` roots of
its primitive. A language applies to the package folders of its `primitives`.
`packagePaths` are section paths inside any package, such as `repo/`. `files`
are regular expressions on the full file path, for apps, features and file
suffixes.

The template registry has four languages:

| Language      | Allowed in                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `react`       | `ui/`, `testing/`, features, `apps/web` and `@repo/design-system`                                                        |
| `@tanstack/*` | `apps/web`                                                                                                               |
| `effect`      | `types/`, `config/`, `repo/`, `service/`, `runtime/`, `testing/`, `.server` files, tests, `packages/sync` and `apps/api` |
| `drizzle-orm` | `repo/`, `service/`, `.server` files and `packages/sync`                                                                 |

## Client code

Client code imports Effect and schemas as types only. Effect code loads after
the first paint, in the sync transport. The
[lint rules for client code](./setup/lint-rules.md#client-code) reject a value
import, and `check-bundle` rejects Effect code in the first screen.

## Server code

`config/`, `repo/`, `service/`, `testing/` and each `.server.ts` file hold
server code. The `repo-imports/server-only` rule lets only server code import
them. Server code is a `.server.ts` file, a file in a server section, a test,
`tools/`, or an app with the Nx tag `platform:server`.

A server change registers in `packages/<name>/runtime/handlers.server.ts`. A
server app loads that file through `apps/api/src/packages.ts`. Only an edge runs
an Effect: `runtime/`, an app or a test. See
[lint rules for Effect code](./setup/lint-rules.md#effect-code).

## Tests

| Rule                                                      | Enforced by                      |
| --------------------------------------------------------- | -------------------------------- |
| `testing/` is imported only by test files and `testing/`  | `repo-imports/testing-imports`   |
| Tests never mock `@repo/*`, `@features/*` or `@/` imports | `repo-imports/no-internal-mocks` |

A test provides a Test Layer in place of a mock. See
[test the workflow](../principles/test-the-workflow.md).

## Exceptions

Move the shared code into a package that both sides can import. When that
cannot happen in this change, add an exception to the `exceptions` list of the
registry. An exception lets the files that match `file` import the specifiers
that match `imports`, past one `rule`:

```yaml
exceptions:
  - rule: vendor-owner
    file: /packages/projects/repo/legacy-billing\.ts$
    imports: ^stripe$
    reason: The legacy webhook checks its signature before billing has a service for it.
```

`rule` is a rule name without the `repo-imports/` prefix. `file` and `imports`
are regular expressions. `reason` says why the import cannot move yet. An
exception without a reason, or with an unknown rule, stops the lint with the
index of the entry. `check-primitives` and
`tools/lint/import-policy-registry.test.ts` check that each exception in the
repository states its reason. Open a
[cleanup issue](../../.github/ISSUE_TEMPLATE/cleanup.yml) to remove the
exception.

## Runtime resolution

Alias mappings live in the tsconfigs. Bun and Vite read them. Plain Node does
not, so run standalone scripts that use aliases with Bun. The Nx generators run
in Node, so they import each other with the `.ts` extension. After you change a
mapping, check resolution in each affected bundler and test runner.
