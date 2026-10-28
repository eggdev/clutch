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

- [0001](./0001-three-tiers-and-package-sections.md): code lives in one of
  three tiers, and each package has fixed sections, with no `src/` and no
  re-exports.
- [0002](./0002-one-owner-for-each-vendor.md): a change of vendor edits one
  package, and no public section shows a vendor type.
- [0003](./0003-local-first-sync-for-every-client.md): a screen never starts a
  request. Only the sync package uses the network.
- [0004](./0004-commands-are-paired-files.md): a command is `<name>.ts` and
  `<name>.server.ts`, not one file that a bundler splits.
- [0005](./0005-effect-is-the-server-language.md): server code uses Effect,
  and Effect Schema is the only schema language.
- [0006](./0006-drizzle-is-the-orm.md): Drizzle 1.0 is the ORM, only in
  `repo/`, never on the client.
- [0007](./0007-effect-loads-after-first-paint.md): the first screen has no
  Effect code.
- [0008](./0008-agent-hooks-guard-the-checks.md): agent hooks run the checks
  during the turn, and a guardrail file needs a human.
- [0009](./0009-react-is-the-default-stack.md): React is the default, with a
  stack profile and no `useEffect` outside one module.

<!-- kickoff: One line for each record that kickoff wrote: the number as a link, then the no in one sentence. -->

## Historical

None yet.
