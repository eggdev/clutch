# Testing

How to choose a test type and run tests in this repository. The durable rules
are in [test the workflow](../principles/test-the-workflow.md) and
[no invasive test-only code](../principles/no-invasive-test-only-code.md).

## Choose the lightest test type

Pick the lightest type that can prove the behavior wrong.

| Type        | Use when                                                                                        | Avoid when                                                               |
| ----------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Unit        | Pure logic, or a module that a typed fake from `src/testing/` covers honestly                   | The assertion needs a real vendor runtime, such as a database or a queue |
| Integration | The behavior depends on the real local runtime of a vendor: queries, storage, sockets           | The code under test never touches the runtime                            |
| End-to-end  | A user-critical journey through the real app. See [end-to-end testing](./end-to-end-testing.md) | An edge case, copy, or anything a faster test covers                     |

<!-- kickoff: The test runner and the file suffix for each type, and the command that runs one file of each type. -->

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

Put setup builders in `packages/<name>/src/testing/`, and call them inside each
test. Do not hide setup in `beforeEach`.
