# Checks

Run every command from the repository root through [Nx](./nx.md).

## Validate

```sh
mise exec -- bun run validate
```

Run it before you say a change is done. CI runs the same command on each PR.
Nx caches results, so a second run with no changes takes seconds. A failure
names its target.

## Checks

Each repository check is a standalone script in `tools/check-*.ts`, with a
target on the root project. [`tools/docs-checks.test.ts`](../../../tools/docs-checks.test.ts)
tests the docs checks.

| Target                 | Rejects                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `lint`                 | Oxlint rules, including the [import boundaries](../import-boundaries.md) |
| `lint-policy-test`     | A change to the import policy that breaks its fixtures                   |
| `format-check`         | Oxfmt differences                                                        |
| `check-docs-file-refs` | A doc link or path to a file that does not exist                         |
| `check-docs-temporal`  | Changelog phrases in durable docs                                        |
| `check-decisions`      | Duplicate decision numbers, or an index that does not match              |
| `check-file-size`      | `AGENTS.md` over 20 lines                                                |
| `check-kickoff-slots`  | A kickoff slot left in a doc after `KICKOFF.md` is deleted               |

Add a check as `tools/check-<name>.ts`, a test, a root target and a row here.
Add the target to `validate` in the root `package.json`.

## Tools

- Typechecks use TSGo (`@typescript/native-preview`). Keep `typescript` only for
  tools that need its JavaScript compiler API.
- Lint uses Oxlint. Formatting uses Oxfmt.

```sh
mise exec -- bun run format   # write formatting
```

## CI

GitHub Actions runs `validate` on each PR. See
[`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml).

<!-- kickoff: Each CI step that the project adds: browser journeys, migration dry runs, preview deploys, the one-way-door label check. -->
