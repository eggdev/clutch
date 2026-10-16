# Documentation

This repository writes for two audiences:

- **Contributors**, people and agents who develop the project: `docs/`,
  package `README.md` files, `AGENTS.md` and `.agents/skills/`.
- **Users**: copy in the product, emails and exports. See
  [project intent](./project-intent.md#who-this-is-for) for who they are and
  which languages each screen needs.

## Principles

**Describe how things work.** Write in the present tense. Do not write
changelog phrases ("now we…", "we no longer…", "previously…"). Describe the
system as it works ("The Worker builds…"), not a rollout ("The Worker now
builds…").

**Keep status and plans out of docs.** A page does not say what is built,
partly built or planned. Work that is not done lives in the issue tracker. A
design that is decided but not built is a [decision record](./decisions/index.md)
until it is built. Then it becomes an architecture page.

**Exceptions.** Decision records are point-in-time by design.
[Project intent](./project-intent.md) keeps "Later, not now" so that nobody
designs those features out. Ordered steps across deploys, such as a
migration procedure, may describe phases. Quoted error messages match what the
product returns.

**User copy follows the same rule.** Screens, emails and exports never read
like release notes.

**Stay lightweight but valuable.** Prefer small, accurate pages over large stale
ones. Update or delete a section in the same change as the code. Link to the
page that owns a fact. Do not copy its paragraphs. When a page grows past one
topic, turn it into a folder with a short `index.md` and one file for each
topic. See [where guidance goes](../principles/lean-agent-context.md#where-guidance-goes).

**Prefer a checker over a should-list.** A rule that lint, TypeScript or a check
can reject belongs in that tool. Docs describe how the system works and point
at the check. When a rule needs reasoning that a cheap check cannot do,
describe the failure mode and stop. Do not add a noisy half-rule. See
[harness engineering](./harness-engineering.md) and [checks](./setup/checks.md).

**Write in Simplified Technical English.** Short sentences, active voice, one
word for one idea. No em dashes.

## Checks

| Check                  | Rejects                                                        |
| ---------------------- | -------------------------------------------------------------- |
| Docs file references   | A link or inline path to a repository file that does not exist |
| Docs temporal language | Changelog phrases in durable docs                              |
| Decision numbers       | Duplicate record numbers, or an index that does not match      |
| File size              | `AGENTS.md` over 20 lines, or a source file over its limit     |
| Kickoff slots          | A kickoff slot left in a doc after kickoff ends                |

## Related

- [Documentation maintenance](./setup/documentation-maintenance.md)
- [Keep agent context lean](../principles/lean-agent-context.md)
- [Examples over prose](../principles/examples-over-prose.md)
