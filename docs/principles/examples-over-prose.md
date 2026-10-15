# Examples over prose

Show one example that matches the current code. When a procedure has more than
one step, make it an Nx target or a `bun` script. The page keeps three things:
when it applies, the command, and what failure looks like.

Each path that a doc cites must exist. The `check-docs-file-refs` target
enforces this. See [checks](../contributing/setup/checks.md).

An example in a template page shows the pattern before the code exists. When
the repository has code that shows the pattern, replace the example with that
code and its path.

## Example

Validate one module and its first consumer:

- When: you change `packages/<name>` or how a consumer uses it.
- Command:
  `mise exec -- bun nx run-many -t test typecheck lint -p @repo/<name>,@repo/<consumer>`
- Failure: a target fails and prints the failing test or lint rule. Fix the
  cause, then run the command again.

## Related

- [Keep agent context lean](./lean-agent-context.md)
