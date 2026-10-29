# Checks

Run every command from the repository root through [Nx](./nx.md).

## Validate

```sh
mise exec -- bun run validate
```

Run it before you say a change is done. CI runs the same command on each PR.
Nx caches results, so a second run with no changes takes seconds. A failure
names its target.

## Git hooks

`bun install` runs the root `prepare` script,
[`tools/hooks/install.ts`](../../../tools/hooks/install.ts). It points Git at
the hooks in `.githooks/`. Each hook runs through `mise`, so it uses the pinned
Bun and Node.

| Hook         | Runs                                                                                                                                           | Skips when                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pre-commit` | On staged files: `oxlint --fix` and `stylelint --fix`, then `oxfmt`. Then `bun install --frozen-lockfile` and the typecheck of the staged tree | The install check and typecheck skip a docs-only commit                                          |
| `pre-push`   | `test`, `lint-policy-test` and `checks` (every fast check and `knip`), with `CI=1` so the Nx cache matches `validate`                          | `test` and `lint-policy-test` skip a docs-only push. Nothing runs when the push deletes a branch |

[`tools/hooks/paths.mjs`](../../../tools/hooks/paths.mjs) defines docs-only:
Markdown anywhere, any file under `docs/`, or a license text. A pushed branch is
compared with the remote tip. A new branch is compared with its merge base on
`origin/HEAD`.

Lint-staged hides unstaged changes while the pre-commit commands run. The
typecheck reads the staged tree, and the formatter changes only staged content.
Lint fixes run before formatting, because a lint fix can leave code unformatted.

Never skip a hook with `--no-verify`. When `pre-commit` or `pre-push` fails,
fix what it found. When a hook is wrong, fix the hook in its own change.

## Checks

Each repository check is a standalone script in `tools/check-*.ts`, with a
target on the root project. [`tools/docs-checks.test.ts`](../../../tools/docs-checks.test.ts)
tests the docs checks. [`tools/repo-checks.test.ts`](../../../tools/repo-checks.test.ts)
tests the workflow and dependency checks.

| Target                       | Rejects                                                                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`                       | Oxlint rules, including the [import boundaries](../import-boundaries.md), and the [CSS lint](./lint-rules.md#css)                                                                                               |
| `lint-policy-test`           | A change to the import policy that breaks its fixtures                                                                                                                                                          |
| `format-check`               | Oxfmt differences                                                                                                                                                                                               |
| `check-docs-file-refs`       | A doc link or path to a file that does not exist                                                                                                                                                                |
| `check-docs-temporal`        | Changelog phrases in durable docs                                                                                                                                                                               |
| `check-suppressions`         | A lint or type suppression comment, such as `oxlint-disable` or `@ts-expect-error`. See [lint rules](./lint-rules.md#how-a-rule-is-chosen)                                                                      |
| `check-terms`                | A word from the [glossary](../glossary.md#rejected-words)'s rejected words table, or an em dash, in contributor docs                                                                                            |
| `check-docs-claims`          | A doc sentence that says a check, lint rule, test or hook enforces a rule, but names none that exists                                                                                                           |
| `check-agent-hooks`          | Claude Code and Codex configs that run different hooks, a hook script that no config calls, or a guardrail file with no owner in `.github/CODEOWNERS`. See [agent hooks](../harness-engineering.md#agent-hooks) |
| `check-sentences`            | A sentence over 25 words in `docs/`. Decision records, skills and `AGENTS.md` are exempt                                                                                                                        |
| `check-commands`             | A command without its `.server.ts` half, a server half without its command or a registration in `runtime/`, or a command with no `waits`                                                                        |
| `check-structure`            | A package folder that is not a section, a loose file in a package, or a feature without `gate.ts` or with other folders. `check-primitives` checks the primitive of each                                        |
| `check-vendor-leaks`         | A vendor type in the built declarations of a public section. It runs after `typecheck`                                                                                                                          |
| `check-bundle`               | A first screen of `apps/web` over 150 kB compressed, or with Effect code in it. It builds the app                                                                                                               |
| `check-decisions`            | Duplicate decision numbers, or an index that does not match                                                                                                                                                     |
| `check-file-size`            | `AGENTS.md` over 20 lines, or a source file over its limit. See [file size](#file-size)                                                                                                                         |
| `knip`                       | An unused file, export or dependency. See [dead code](#dead-code)                                                                                                                                               |
| `check-kickoff-slots`        | A kickoff slot left in a doc after `KICKOFF.md` is deleted                                                                                                                                                      |
| `check-primitives`           | A broken [registry](../architecture/primitives.yaml) entry, or an Nx project with no primitive                                                                                                                  |
| `check-workflows`            | A step or job reference that names nothing, a missing `permissions` block, `pull_request_target`                                                                                                                |
| `check-user-docs`            | A user page whose frontmatter breaks the table in [user docs](../../users/README.md)                                                                                                                            |
| `check-migrations`           | A change, rename or deletion of a migration that reached `main`. See [migrations](./migrations.md)                                                                                                              |
| `check-db`                   | A schema change with no migration, or a migration that drizzle-kit did not write. See [migrations](./migrations.md#only-drizzle-kit-writes-migrations)                                                          |
| `check-lockfile`             | A `bun.lock` that does not match the manifests                                                                                                                                                                  |
| `check-dependency-overrides` | An override without a documented reason, a stale reason, or a repeated JSON key                                                                                                                                 |
| `audit-prod`                 | A moderate or worse advisory in a production dependency                                                                                                                                                         |

Add a check as `tools/check-<name>.ts`. Export a `check<Name>(root)` function
that returns the problems, so a test can call it on a temporary repository. Add
a test, a root target in `package.json`, the target in the `dependsOn` list of
the root `checks` target, and a row here. `validate` and the pre-push hook both
run `checks`, so the new check runs in both.

A failure message names the file, the problem and the fix. Print the fix hint
and a link to the page that owns the rule above the list of problems. See
[harness engineering](../harness-engineering.md#make-failures-teach-the-fix).

`check-workflows` reads each workflow with `Bun.YAML`. GitHub turns a
`steps.<id>` or `needs.<id>` reference to a missing step or job into an empty
string, and the run continues. See [CI](#ci) for the other two rules.

[Dependencies](./dependencies.md) explains `check-dependency-overrides` and
`audit-prod`. `audit-prod` needs network access.

## File size

A source or test file has at most 400 lines.
[`tools/file-size-budgets.json`](../../../tools/file-size-budgets.json) sets the
limit and lists the files that may pass it. The check skips files that Git
ignores, such as build output.

A deep module can be the right design: a small interface over a lot of logic,
where a split would only pass state between files. Such a file gets an entry
with a line budget and the reason it stays deep. Raise the budget in the same
change that grows the file, and update the reason when it changes. A review
reads the reason. `check-file-size` rejects:

- A file over the limit with no entry
- A file over its budget
- An entry with no reason
- An entry for a file that is within the limit, or for a file that does not exist

Never make code denser to fit a budget: no lists folded into a regex, no
helpers squeezed onto one line. Readable code with a raised budget is better
than dense code under the old one.

When a file outgrows its design, split it. A split keeps every test: the test
count is the same before and after.

## Dead code

`knip` reports unused files, exports and dependencies. It finds entry points
from the `package.json` scripts and the Nx targets.
[`knip.jsonc`](../../../knip.jsonc) adds the entries that it cannot find, such
as test files. Each added entry has a comment with its reason. A leftover is
deleted, not listed. See
[delete what is off the common path](../../principles/delete-off-the-common-path.md).

When a tool calls a file in a way that knip cannot see, run it through a
`package.json` script. The Git hooks do this: they call `hooks:pre-commit` and
`hooks:pre-push`.

## Test time budget

Each test target runs through
[`tools/test-budget.ts`](../../../tools/test-budget.ts). A suite that takes more
than 60 seconds fails, even when every test passes. A slow suite slows every
push, and it is often the first sign of a test that reaches the network or
builds too much setup.

When the budget fails, make the slowest tests faster. `bun test` prints the time
of each one. Never delete or skip a test to fit the budget. Raise a budget only
in a reviewed change that says why. The budget is the first argument of the
target's command in `package.json`.

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
as `Name: message`, with no stack. `tools/testing/console-guard.ts` also fails
a test that allows a message and does not log it. Never replace `console.error` or `console.warn` with a
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

`check-bundle` is the budget for the first screen of `apps/web`. A byte count
does not vary between runs, so it takes one sample. See
[client performance](../architecture/client-performance.md).

<!-- kickoff: The performance budgets of the project: what each one measures (startup time, bundle bytes, query count), the budget file, the check target and the user cost it protects. Delete this slot when the project has no budget. -->

## Tools

- Typechecks use TSGo (`@typescript/native-preview`). Keep `typescript` only for
  tools that need its JavaScript compiler API.
- Lint uses Oxlint for code and Stylelint for CSS. Formatting uses Oxfmt.
- The lint rules and how each one is chosen are on
  [lint rules](./lint-rules.md).

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
