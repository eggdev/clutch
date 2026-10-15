# Engineering principles

Short, durable rules for how we build. Each page is one principle. Open only
the page the task needs. Read [project intent](../contributing/project-intent.md)
first for product decisions.

These pages are the same in every project that starts from the template. A page
here never states a fact about one product. It links to the project page that
owns the fact.

| Principle                                                                   | When to open it                                                                               |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [Generic platform](./generic-platform.md)                                   | Importing a vendor, adding a module, or deciding which module owns a vendor                   |
| [Normalized source of truth](./normalized-source-of-truth.md)               | Adding a cache, index or second store for a fact that already has a record                    |
| [Delete what is off the common path](./delete-off-the-common-path.md)       | A migration left an old lane, or a branch, field, flag or doc serves a path the product skips |
| [Fail loudly at the right layer](./fail-loudly.md)                          | An error could be swallowed so a partial result continues                                     |
| [Fix the root bottleneck](./fix-the-root-bottleneck.md)                     | Masking slowness with timeouts, fallbacks or caches                                           |
| [Two-way and one-way doors](./two-way-doors.md)                             | Changing a stored shape, a hard invariant, or anything a copy outlives                        |
| [Examples over prose](./examples-over-prose.md)                             | Writing docs, skills or a procedure with more than one step                                   |
| [Keep agent context lean](./lean-agent-context.md)                          | Editing `AGENTS.md` or skills, or deciding where guidance goes                                |
| [No invasive test-only code in production](./no-invasive-test-only-code.md) | Adding test seams, test-only exports, env branches or fixture entrypoints                     |
| [Test the workflow](./test-the-workflow.md)                                 | Adding or changing tests, fakes or end-to-end journeys                                        |

Related maps: [contributing index](../contributing/index.md),
[decision records](../contributing/decisions/index.md),
[harness engineering](../contributing/harness-engineering.md).
