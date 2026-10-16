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
tests the docs checks. [`tools/repo-checks.test.ts`](../../../tools/repo-checks.test.ts)
tests the workflow and dependency checks.

| Target                       | Rejects                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `lint`                       | Oxlint rules, including the [import boundaries](../import-boundaries.md)                         |
| `lint-policy-test`           | A change to the import policy that breaks its fixtures                                           |
| `format-check`               | Oxfmt differences                                                                                |
| `check-docs-file-refs`       | A doc link or path to a file that does not exist                                                 |
| `check-docs-temporal`        | Changelog phrases in durable docs                                                                |
| `check-decisions`            | Duplicate decision numbers, or an index that does not match                                      |
| `check-file-size`            | `AGENTS.md` over 20 lines                                                                        |
| `check-kickoff-slots`        | A kickoff slot left in a doc after `KICKOFF.md` is deleted                                       |
| `check-workflows`            | A step or job reference that names nothing, a missing `permissions` block, `pull_request_target` |
| `check-user-docs`            | A user page whose frontmatter breaks the table in [user docs](../../users/README.md)             |
| `check-dependency-overrides` | An override without a documented reason, a stale reason, or a repeated JSON key                  |
| `audit-prod`                 | A moderate or worse advisory in a production dependency                                          |

Add a check as `tools/check-<name>.ts`. Export a `check<Name>(root)` function
that returns the problems, so a test can call it on a temporary repository. Add
a test, a root target in `package.json`, the target in the `validate` script,
and a row here.

A failure message names the file, the problem and the fix. Print the fix hint
and a link to the page that owns the rule above the list of problems. See
[harness engineering](../harness-engineering.md#make-failures-teach-the-fix).

`check-workflows` reads each workflow with `Bun.YAML`. GitHub turns a
`steps.<id>` or `needs.<id>` reference to a missing step or job into an empty
string, and the run continues. See [CI](#ci) for the other two rules.

[Dependencies](./dependencies.md) explains `check-dependency-overrides` and
`audit-prod`. `audit-prod` needs network access.

## Test output

[`tools/testing/console-guard.ts`](../../../tools/testing/console-guard.ts) is
a test preload. `bunfig.toml` loads it for every `bun test` run. An unexpected
`console.error` or `console.warn` fails the test that logs it. The failure
prints the exact message.

When a test expects a message, allow that exact message in the test:

```ts
import { allowConsole } from '@tools/testing/console-guard';

test('a retry warns once', async () => {
  allowConsole('warn', 'sync: retry 2 of 3');
  await syncWithOneFailure();
});
```

The message is the logged arguments as `console` formats them. An Error shows
as `Name: message`, with no stack. An allowed message that the test does not
log also fails the test. Never replace `console.error` or `console.warn` with a
mock to hide output. A blanket mock hides the next regression too.

## Performance budgets

A performance check compares a measurement with a committed budget:

1. Keep the budget in a JSON file next to the check, such as
   `tools/<name>-budget.json`. A budget change is a reviewed diff.
2. Take three samples and compare the best one with the budget. The best sample
   drops runner noise. A real regression slows every sample.
3. Set the budget above the steady reading and below the level that hurts users.
4. When a change buys headroom, lower the budget in the same PR.
5. When growth is intentional, raise the budget in the same PR and give the
   reason in the PR description.

Run the check after the parallel targets, so other work does not inflate the
samples.

<!-- kickoff: The performance budgets of the project: what each one measures (startup time, bundle bytes, query count), the budget file, the check target and the user cost it protects. Delete this slot when the project has no budget. -->

## Tools

- Typechecks use TSGo (`@typescript/native-preview`). Keep `typescript` only for
  tools that need its JavaScript compiler API.
- Lint uses Oxlint. Formatting uses Oxfmt.
- `.oxlintrc.json` extends
  [`tools/lint/oxlint-rules.json`](../../../tools/lint/oxlint-rules.json) and
  holds only the ignore patterns. Oxlint does not inherit `ignorePatterns`
  through `extends`. Add plugins and rules to the rules file.
- The rules file turns on `typescript/no-explicit-any` and
  `no-warning-comments`. A marker comment such as FIXME or HACK fails lint.
  Record the work in an issue.

```sh
mise exec -- bun run format   # write formatting
```

## CI

GitHub Actions runs `validate` on each PR. See
[`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml).

- Each workflow sets a top-level `permissions` block. Start from
  `contents: read`, and grant more only in the job that needs it.
- A PR from a fork never gets a token that writes, such as a cache write token
  or a deploy token. GitHub withholds secrets from fork `pull_request` runs. Do
  not use `pull_request_target` to pass one. `check-workflows` rejects that
  trigger.
- A shared cache takes writes only from runs of people who can push to the
  repository. A fork PR job reads the cache at most.
- CI and the `validate` script both set `CI=1`. Nx test hashes include `CI`, so
  an agent run of `validate` and a CI run share cache keys. See
  [Nx](./nx.md#cache-keys).

<!-- kickoff: Each CI step that the project adds: browser journeys, migration dry runs, preview deploys, the one-way-door label check. -->
