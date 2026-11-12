# Decision records

A steering list of product-shaped decisions that are already made. Most are a no
with a revisit-if. Read the steering list before you propose a new primitive,
surface or storage home. [Architecture](../architecture/index.md) and code
describe how the system works.

## Keep a record short

Agents load these records often. A record has three parts: context, decision,
consequences. It has at most 500 words. A record that needs more is usually two
decisions, or an architecture page.

## When to add a record

The template docs describe the baseline that every project starts with. Do not
write a record for a template default. Write one only for a project's own
departure from the baseline, or for its own no.

Write one after you decide not to build something that the next agent would
otherwise propose again. Also write one before you go through a
[one-way door](../../principles/two-way-doors.md), such as a stored shape change.

1. Copy [`0000-template.md`](./0000-template.md) to the next unused number, with
   a kebab-case slug. Check this index on `main` first.
2. Add the record to the steering list below with a one-line summary of the no.

Do not write a record for each PR, for a layout or UI change, or for a library
pick that the code already shows.

The `check-decisions` target rejects:

- A duplicate number, or a file name that is not `NNNN-kebab-slug.md`
- A status other than the three above, or a status link to a record that does
  not exist or is not later
- A record with no `**Revisit if:**` line
- A record over 500 words
- A record that this index does not list once, or lists in the wrong section

## Changing a decision

Do not edit or delete an accepted record. Write a new record, then change only
the status line of the old one:

| The new record               | Old status                             | Old record in the index |
| ---------------------------- | -------------------------------------- | ----------------------- |
| Replaces the whole decision  | `superseded by [NNNN](./NNNN-slug.md)` | Historical              |
| Changes part of the decision | `amended by [NNNN](./NNNN-slug.md)`    | Steering list           |

A record amended more than once lists each amending record:
`amended by [0007](./0007-a.md), [0012](./0012-b.md)`.

## Steering list

<!-- kickoff: One line for each record that kickoff wrote: the number as a link, then the no in one sentence. -->

- [0001](./0001-allow-shrink-only-ratchets.md): a repository may keep a shrink-only ratchet baseline for a rule it adopts. No other baseline of old violations.
- [0002](./0002-merge-most-prs-with-no-human.md): 80% of PRs merge with no human. No person reviews a change outside the hard core unless agent review finds a weaker check.
- [0004](./0004-no-design-canvas-tool-for-proposals.md): no design canvas tool, such as Pencil or Paper. Design proposals render in the app, on the real design system.
- [0005](./0005-the-owner-signs-off-what-cannot-be-paid-back.md): the owner signs off a major change, a credential, auth, access, identity and a migration. Other changes merge on proof, and the owner pays a problem back.

## Historical

- [0003](./0003-a-pure-clutch-sync-takes-owner-findings-as-approved-upstream.md): a pure Clutch sync's owner findings held no PR. Record 0005 supersedes it: no owner finding holds a PR now.
