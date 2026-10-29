# Test the workflow

A test is good when it proves that the system behaves correctly. Do not write
tests for coverage.

One test is one workflow: the setup, the actions, and the assertions that prove
it. An assertion needs an oracle that the production code does not share.

## What to test

- Each kind of module has behavioral tests in its own package: design-system
  components, services, commands, repos and API endpoints.
- A few end-to-end journeys prove the
  [hard invariants](../contributing/project-intent.md#hard-invariants). Each
  invariant has one journey. Project intent lists the journeys. Add each
  journey when its feature exists.

## No mocks of our code

Never mock an internal module. The `repo-imports/no-internal-mocks` lint rule
rejects `mock.module`, `jest.mock`, `vi.mock` and `spyOn` on `@repo/*`,
`@features/*` and `@/` imports. A test provides a Test Layer instead.

Our own code always runs for real in a test. Only an upstream vendor gets a
stand-in, and only at the edge where our code calls the vendor. For a vendor,
use the highest rung that exists:

1. **The real service, run locally.** For example PGlite for Postgres, workerd
   and Miniflare for Cloudflare, or `stripe-mock`. The template's tests run the
   real event log on PGlite.
2. **A mock API server, when the vendor speaks HTTP and has no local
   runtime.** It answers the vendor's API on a local port. Our code calls
   it the way it calls the vendor, through its normal client and
   configuration. It lives in `tools/mocks/<vendor>/`, so production code
   cannot import it, and it shows what it received at a `/__mocks` route. Local development, previews and end-to-end tests share it.
   For example, an email mock keeps each sent message, and a journey reads the
   sign-in code from it. The journey never reads the code from the database.
3. **A fake, for a unit test.** The fake lives in the owner package's
   `testing/`, with a Test Layer that provides it. It satisfies the same
   service as the Live Layer. Never patch an import.

Run a shared contract suite against each mock and fake on every run, and
against the real service on a schedule. When the real service fails the suite
and the stand-in passes it, the stand-in drifted.

## Structure

- Flat `test(...)`. Inline the setup. Skip `describe`, `beforeEach` and shared
  mutable state.
- Do not pin exported constants, copy production helpers or repeat checks that
  the type system makes.
- An absence assertion runs on a live path that could still show the thing.
  Examples are an admin view next to a user view, or a full list next to an
  empty one.
- Tests run with no network. A vendor is a local runtime or a fake.
- Put setup builders and Test Layers in `packages/<name>/testing/`. Tests in
  any package can import them. Production code cannot.
- Each repo has a round-trip test: a row becomes the public record and back.

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
