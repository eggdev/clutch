# Decision records

A steering list of product-shaped decisions that are already made. Most are a no
with a revisit-if. Read the steering list before you propose a new primitive,
surface or storage home. [Architecture](../architecture/index.md) and code
describe how the system works.

## Keep a record short

Agents load these records often. Aim for half a page: context, decision,
consequences. A record that needs more is usually two decisions, or an
architecture page.

## When to add a record

Write one after you decide not to build something that the next agent would
otherwise propose again. Also write one before you go through a
[one-way door](../../principles/two-way-doors.md), such as a stored shape change.

1. Copy [`0000-template.md`](./0000-template.md) to the next unused number, with
   a kebab-case slug. Check this index on `main` first.
2. Add the record to the steering list below with a one-line summary of the no.

Do not write a record for each PR, for a layout or UI change, or for a library
pick that the code already shows. The `check-decisions` target rejects a
duplicate number or a record that this index does not list once.

## Changing a decision

Do not edit or delete an accepted record. Write a new record, mark the old one
`superseded by NNNN`, and move it to the historical list.

## Steering list

<!-- kickoff: One line for each record that kickoff wrote: the number as a link, then the no in one sentence. -->

## Historical

None yet.
