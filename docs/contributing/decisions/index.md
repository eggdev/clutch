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

## Historical

None yet.
