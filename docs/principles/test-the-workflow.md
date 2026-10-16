# Test the workflow

A test is good when it proves that the system behaves correctly. Do not write
tests for coverage.

One test is one workflow: the setup, the actions, and the assertions that prove
it. An assertion needs an oracle that the production code does not share.

## What to test

- Each layer has behavioral tests in its own package: design-system atoms,
  service behavior, domain commands and API endpoints.
- A few end-to-end journeys prove the
  [hard invariants](../contributing/project-intent.md#hard-invariants). Each
  invariant has one journey. Project intent lists the journeys. Add each
  journey when its feature exists.

## No mocks of our code

Never mock an internal module. The `repo-imports/no-internal-mocks` lint rule
rejects `mock.module`, `jest.mock`, `vi.mock` and `spyOn` on `@repo/*` and `@/`
imports.

Our own code always runs for real in a test. Only an upstream vendor gets a
stand-in, and only at the edge where our code calls the vendor. For a vendor,
use the highest rung that exists:

1. **The real service, run locally.** For example workerd and Miniflare for
   Cloudflare, a Postgres container, or `stripe-mock`.
2. **A mock API server, when the vendor speaks HTTP and has no local
   runtime.** It answers the vendor's API on a local port, and our code calls
   it the way it calls the vendor, through its normal client and
   configuration. It lives in `tools/mocks/<vendor>/`, so production code
   cannot import it, and it shows what it received at a `/__mocks` route. Local development, previews and end-to-end tests share it.
   For example, an email mock keeps each sent message, and a journey reads the
   sign-in code from it. The journey never reads the code from the database.
3. **A typed fake, for a unit test.** The fake lives in the owner module's
   `src/testing/`. It is typed against the SDK interface, and it connects
   through the module's port. Never patch an import.

A shared contract suite runs against each mock and fake on every run, and
against the real service on a schedule. A test that fails on the real service
and passes on the stand-in shows that the stand-in drifted.

## Structure

- Flat `test(...)`. Inline the setup. Skip `describe`, `beforeEach` and shared
  mutable state.
- Do not pin exported constants, copy production helpers or repeat checks that
  the type system makes.
- An absence assertion runs on a live path that could still show the thing:
  an admin view next to a user view, a full list next to an empty one.
- Tests run with no network. A vendor is a local runtime or a fake.
- Put setup builders in `packages/<name>/src/testing/`. Tests in any package can
  import them. Production code cannot.

## Example

```ts
expect(isResetMessage(resetMessageConstant.replace(/\.$/, ''))).toBe(true);
```

This fails when normalization changes.
`expect(isResetMessage(resetMessageConstant)).toBe(true)` does not, because the
matcher is the constant.

## Related

- [Testing](../contributing/testing.md): test types, console output and
  `await using`
- [End-to-end testing](../contributing/end-to-end-testing.md)
- [No invasive test-only code in production](./no-invasive-test-only-code.md)
