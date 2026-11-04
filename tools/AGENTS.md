# Tools agent rules

Each file is a repository check or script. `tools/validate.ts` runs the checks.

- Run all checks: `mise exec -- bun run validate`.
- Run one check: `mise exec -- bun tools/<name>.ts`.
- Test it: `mise exec -- bun test tools`.
- A check exports a function that takes `root` and returns its problems.
- A check keeps an `import.meta.main` block for the command line.
- Put the tests of a new check in `<name>.test.ts` next to it.
- Give a new check a `package.json` target, and add it to the `dependsOn` list of `checks`.
- Add a row for a new check on the docs page that owns it.

Links:

- [Setup and checks](../docs/contributing/setup/index.md)
- [Root agent rules](../AGENTS.md)
