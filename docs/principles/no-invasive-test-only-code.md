# No invasive test-only code in production

Production code must not carry test-only seams. The test: would production keep
this code if every test were deleted? If not, it does not belong in production.

## Violations

- Branches on `NODE_ENV`, `BUN_ENV` or `isTest` that change behavior under test
- Exports that exist only so tests can reach them (`*ForTests`, `__testOnly*`)
- Parameters, options or injection points that only tests use
- Fakes in a production bundle, or production code that imports `src/testing/`
- Env vars, routes or timing hooks that only tests use
- Test-only entrypoints or configs beside production entrypoints. Put fixture
  apps and their configs in the app's `test/` folder.

## Prefer instead

- Real behavior through public interfaces
- Real local runtimes of each vendor
- Setup builders and vendor fakes in `packages/<name>/src/testing/`

## Not violations

- Configuration that production also uses: feature flags, real env vars, URLs
- Ports that have a production purpose, such as a parser interface with two
  real implementations

## Related

- [Test the workflow](./test-the-workflow.md)
