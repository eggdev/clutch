# Keep agent context lean

Agents load guidance when a task needs it. Keep the entry map small, put detail
one hop away in a focused page, and state each rule in one place only.

## Rules

- Root `AGENTS.md` is a map of links, 20 lines or fewer. The `check-file-size`
  target enforces the limit.
- Agents open an index, then only the page the task needs. Do not copy a rule
  into `AGENTS.md`, a skill and a doc.
- When behavior changes, update the page that owns it in the same change. If you
  move guidance, leave a short link at the old place.

## Where guidance goes

| Guidance                                     | Home                             |
| -------------------------------------------- | -------------------------------- |
| Why the product exists, users, invariants    | `contributing/project-intent.md` |
| A durable rule about how we build            | `principles/`                    |
| How one module or flow works                 | `contributing/architecture/`     |
| How to run, check or deploy                  | `contributing/setup/`            |
| A no that the next agent would propose again | `contributing/decisions/`        |
| A repeatable task with steps                 | `.agents/skills/`                |
| A module's API and limits                    | That package's `README.md`       |
| Work that is not done                        | The issue tracker                |

## Related

- [Examples over prose](./examples-over-prose.md)
- [Harness engineering](../contributing/harness-engineering.md)
