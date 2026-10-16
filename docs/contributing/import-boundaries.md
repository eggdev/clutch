# Import boundaries

This page lists every import rule in the repository. Each rule names the lint
rule that enforces it. Run the lint with `mise exec -- bun run check`. Test the
policy with `mise exec -- bun nx run-many -t lint-policy-test`.

The policy is [`tools/lint/import-policy.mjs`](../../tools/lint/import-policy.mjs).
Its project data is [`tools/lint/boundaries.json`](../../tools/lint/boundaries.json).
[`oxlint.config.ts`](../../oxlint.config.ts) turns on
each rule. The policy also exports its matchers and its `boundaries.json`
parser, so a test can check them without a lint run.

Every rule reads each module specifier in a file: static imports, re-exports,
dynamic `import()`, type imports, `require`, and the first argument of
`vi.mock`, `jest.mock`, `mock.module` and their relatives, such as
`vi.importActual`. A test cannot route around a boundary with a mock.

## Services and domains

A **service** is a focused unit of behavior that acts the same way everywhere
it is used, such as identity, access, email or storage. A service can be one
atom of behavior or combine other services, as a molecule.

A **domain** combines services into a feature that a user works with. A domain
is an organism.

Each package declares its kind with an Nx tag in its `package.json`:
`type:service` or `type:domain`.
[`tools/lint/check-manifests.ts`](../../tools/lint/check-manifests.ts) rejects a
package without exactly one of them.

| Rule                                       | Enforced by                        |
| ------------------------------------------ | ---------------------------------- |
| A service never imports a domain           | `repo-imports/module-direction`    |
| A domain never imports another domain      | `repo-imports/module-direction`    |
| No import cycles between packages          | `repo-imports/no-cycles`           |
| A package never imports an app or `tools/` | `repo-imports/module-dependencies` |

A service can import any other service. Apps compose domains.

## Aliases

| Alias      | Resolves to          | Use                               |
| ---------- | -------------------- | --------------------------------- |
| `@/…`      | The current app root | Files in the same app             |
| `@repo/…`  | `packages/…`         | Package files                     |
| `@apps/…`  | `apps/…`             | Application files in service code |
| `@tools/…` | `tools/…`            | Tooling                           |

Aliases mirror source paths, including `src`. Import the file you need. Deep
imports are allowed, and packages have no barrel files. Platform suffixes such
as `.native` stay part of the file name:

```ts
import { createIdentity } from '@repo/identity/src/server';
```

`repo-imports/aliases-only` rejects:

- Relative module specifiers, including in re-exports, dynamic imports,
  CommonJS, type imports and test runner mocks
- The bare `@repo/<name>` package entrypoint
- `exports` maps in workspace package manifests

Relative file system and configuration paths are not module imports. This rule
does not cover them.

## Vendors and layers

| Rule                                                                                                       | Enforced by                        |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| A vendor is imported only in its owner module. See [generic platform](../principles/generic-platform.md)   | `repo-imports/vendor-owner`        |
| A shared language, such as a query builder or a UI framework, is imported only in the folders of its layer | `repo-imports/layers`              |
| Client and contract files never import server code, vendors or framework runtimes                          | `repo-imports/module-dependencies` |

Add a vendor or a layer to `boundaries.json` in the same change that adds the
dependency:

```json
{
  "vendors": [{ "vendor": "Stripe", "imports": "^stripe(?:/|$)", "owner": "billing" }],
  "layers": [
    {
      "imports": "^drizzle-orm(?:/|$)",
      "where": "`src/server/db/**` and `@repo/storage`",
      "packages": ["storage"],
      "packagePaths": ["src/server/db/"]
    }
  ]
}
```

`owner` and `packages` are folder names under `packages/`. `packagePaths` are
paths inside any package. `files` are regular expressions on the full file path,
for app folders.

## Tests

| Rule                                                               | Enforced by                      |
| ------------------------------------------------------------------ | -------------------------------- |
| `src/testing/**` is imported only by test files and `src/testing/` | `repo-imports/testing-imports`   |
| Tests never mock `@repo/*` or `@/` imports                         | `repo-imports/no-internal-mocks` |

See [test the workflow](../principles/test-the-workflow.md).

## Exceptions

Move the shared code into a module that both sides can import. When that
cannot happen in this change, add an exception to `boundaries.json`. An
exception lets the files that match `file` import the specifiers that match
`imports`, past one `rule`:

```json
{
  "exceptions": [
    {
      "rule": "vendor-owner",
      "file": "/packages/projects/src/server/legacy-billing\\.ts$",
      "imports": "^stripe$",
      "reason": "The legacy webhook checks its signature before billing has a port for it."
    }
  ]
}
```

`rule` is a rule name without the `repo-imports/` prefix. `file` and `imports`
are regular expressions. `reason` says why the import cannot move yet. An
exception without a reason, or with an unknown rule, stops the lint with the
index of the entry. `tools/lint/import-policy.test.ts` checks that each
exception in the repository states its reason. Open a
[cleanup issue](../../.github/ISSUE_TEMPLATE/cleanup.yml) to remove the
exception.

## Runtime resolution

Alias mappings live in the tsconfigs. Bun reads them. Plain Node does not, so
run standalone scripts that use aliases with Bun. After you change a mapping,
check resolution in each affected bundler and test runner.
