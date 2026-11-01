# Testing

How to choose a test type and run tests in this repository. The durable rules
are in [test the workflow](../principles/test-the-workflow.md) and
[no invasive test-only code](../principles/no-invasive-test-only-code.md).

## Journeys first

A [journey](./glossary.md#checks-and-process) is the main behavioral test. It
drives the real app the way a user does, so it fails when the product fails.
Each feature that an app ships has at least one journey for that platform.
`check-journeys` rejects a shipped feature with no journey. See
[journeys](./setup/verification.md#journeys) for the files and the commands.

Add an integration test when a vendor runtime decides the behavior, such as a
query or a socket. Add a unit test only for logic with many cases that a
journey would run slowly.

## Choose the lightest test type

After the journey, pick the lightest type that can prove the behavior wrong.

| Type        | Use when                                                                              | Avoid when                                                               |
| ----------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Unit        | Pure logic, or a module that a Test Layer from `testing/` covers honestly             | The assertion needs a real vendor runtime, such as a database or a queue |
| Integration | The behavior depends on the real local runtime of a vendor: queries, storage, sockets | The code under test never touches the runtime                            |
| End-to-end  | A journey through the real app. See [end-to-end testing](./end-to-end-testing.md)     | An edge case, copy, or anything a faster test covers                     |

<!-- kickoff: The test runner and the file suffix for each type, and the command that runs one file of each type. -->

## Test rules

A test proves the behavior that a user or a caller sees. A test that only
raises a coverage number costs run time and proves nothing. The
`repo-tests` lint plugin in `tools/lint/test-policy.mjs` enforces these rules
in every test file:

| Rule              | Rejects                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `no-hidden-tests` | `skip`, `only`, `todo`, `if`, `skipIf`, `todoIf` and `failing`, and `xtest`, `xit`, `fit` |
| `no-snapshots`    | `toMatchSnapshot`, `toMatchInlineSnapshot` and the snapshot forms of `toThrow`            |
| `assert-behavior` | A test with no assertion, and a test whose only assertions check that a value exists      |

An existence check is `toBeDefined`, `toBeTruthy`, `not.toBeNull`,
`not.toBeUndefined`, `not.toBeFalsy` or `not.toThrow`. Assert the value
instead. A helper that asserts has a name that starts with `expect` or
`assert`, such as `expectErrorCode`, so the rule counts it.

## Test integrity

`check-test-integrity` compares the working tree with the base commit. CI
sets the base in `CHECK_BASE`. Locally, the base is the merge base with
`origin/HEAD`, or with `origin/main` when the clone has no `origin/HEAD`. See
[`tools/check-base.ts`](../../tools/check-base.ts). The check fails when a change does any of these:

- It deletes a test file.
- It renames a test file to a name that no test runner runs.
- It lowers the number of tests or assertions in a test file.

A test file may go in the same change that deletes the module it tests:
`pool.test.ts` goes with `pool.ts`. For any other reason, list the test file
in [`tools/test-integrity-allow.json`](../../tools/test-integrity-allow.json)
with the reason. That file is a guardrail file, so a person reviews the
entry. Delete the entry after the change merges.

## Flaky tests

A flaky test passes and fails on the same code. Fix it. When the fix takes
longer than the PR at hand, quarantine the test: never delete it, and never
skip it in the file. The lint rule `repo-tests/no-hidden-tests` refuses
`test.skip` and `test.skipIf`.

The quarantine is [`tools/flaky-tests.json`](../../tools/flaky-tests.json).
Each entry names one test:

| Field    | What it holds                                                    |
| -------- | ---------------------------------------------------------------- |
| `file`   | The `bun test` file, such as `tools/check-db.test.ts`.           |
| `name`   | The exact name in the test call, also inside a `describe` block. |
| `issue`  | The open issue that owns the fix. Its `owner` owns the test.     |
| `until`  | The last day of the quarantine, at most 30 days ahead.           |
| `reason` | What failed and where, such as the CI run.                       |

- `tools/test-budget.ts` runs each `bun test` target. It leaves the
  quarantined tests out, so they cannot block a merge.
- The CI step `quarantined tests` runs each one on its own, up to 3 times. It
  writes a table to the job summary: passed, flaky, or failed every attempt.
  It never fails the job.
- `check-flaky-tests` fails on an expired entry, or an entry whose issue is
  missing or `done`. It also fails on a name that is not in the file, and on an
  expiry more than 30 days ahead. A new date needs a new reason in review.
- Remove the entry in the PR that fixes the test.

## Console output

An unexpected `console.error` or `console.warn` fails the test. Stray output
hides real regressions, so keep test output clean.

When a test expects a message, allow that exact message in the test. Never
silence the console for a whole file or with a blanket mock. Anything outside
the allowance still fails the test.

The guard is a test preload. See [test output](./setup/checks.md#test-output)
for how a test allows a message.

## Release test resources with `using`

A test resource that needs cleanup returns a disposable. The test declares it
with `using` or `await using`, so cleanup runs even when an assertion fails:

```ts
import { expect, test } from 'bun:test';
import { createServer } from 'node:http';

async function createDisposableServer() {
  const server = createServer((_request, response) => response.end('ok'));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The test server has no port');
  return {
    url: `http://localhost:${address.port}`,
    [Symbol.asyncDispose]: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('fetches from a disposable server', async () => {
  await using server = await createDisposableServer();
  expect(await (await fetch(server.url)).text()).toBe('ok');
});
```

## Setup

Put setup builders and Test Layers in `packages/<name>/testing/`, and call them
inside each test. Do not hide setup in `beforeEach`. Examples:

- `packages/sync/testing/database.ts` gives each test its own PGlite
  database. A process migrates once for each list of migrations, and each test
  loads that dump, so a test does not pay for the migrations.
- `packages/sync/testing/render-warm.tsx` renders a screen with a warm object
  pool and fails on any network call.
- `packages/notes/testing/notes.ts` runs the notes commands through the Test
  Layers.

## Split a test file

When a test file passes its size limit, split it by workflow. Compare the test
count from `bun test` before and after the split. The counts are the same.
