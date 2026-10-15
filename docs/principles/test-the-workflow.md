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

For an upstream vendor, use the highest rung that exists:

1. **The real service, run locally.** For example workerd and Miniflare for
   Cloudflare, a Postgres container, or `stripe-mock`.
2. **A fake, only when no local runtime exists.** The fake lives in the owner
   module's `src/testing/`. It is typed against the SDK interface. A shared
   contract suite runs against the fake on each run and against the real service
   on a schedule. A test that fails on the real service and passes on the fake
   shows that the fake drifted.

Connect a fake through the module's port. Never patch an import.

## Structure

- Flat `test(...)`. Inline the setup. Skip `describe`, `beforeEach` and shared
  mutable state.
- Do not pin exported constants, copy production helpers or repeat checks that
  the type system makes.
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

- [No invasive test-only code in production](./no-invasive-test-only-code.md)
