# 0001: Three tiers, and fixed sections in each package

- **Status:** accepted
- **Date:** 2026-10-28

## Context

Agents put code where it is easiest: a `lib/` folder in the app, or a large
file that grows each week. Today a package has a `src/` folder with
`client.ts`, `server.ts`, `server/db/` and `ui/`. Deep imports are allowed, so
every file is public, and a package has no small interface. "Service" and
"domain" packages are the only kinds, and a user-facing feature has no home.

## Decision

The workspace has three tiers. Imports go in one direction:
`apps` to `features` to `packages`.

- An app holds routes, the composition root and runtime configuration.
  Nothing imports an app.
- A feature holds the screens, the gate and the components for one area of
  the product. A feature never imports another feature.
- A package owns one capability, and the records and vendors that it needs.

A package has no `src/` folder. It has only the sections that it needs. Each
section is a folder, never a single file:

| Section     | Access     | Holds                                                  |
| ----------- | ---------- | ------------------------------------------------------ |
| `types/`    | Public     | Effect Schemas for records, IDs, inputs and errors     |
| `config/`   | Private    | Environment keys and settings                          |
| `models/`   | Public     | Models: fields, relations, sync groups, load functions |
| `commands/` | Public     | Commands, as paired files (see 0004)                   |
| `repo/`     | Private    | Drizzle tables, queries and migrations                 |
| `service/`  | Public     | Effect services: invariants and access checks          |
| `runtime/`  | Apps only  | Live Layers, server handlers and wiring                |
| `ui/`       | Public     | Hooks and components                                   |
| `testing/`  | Tests only | Fakes and Test Layers                                  |

The public sections are the interface of the package. The import aliases are
`@/` inside an app, `@repo/<package>/<section>/...`, `@features/<feature>/...`
and `@tools/...`. The `@apps/` alias goes away. A file has one import path, and
a re-export is not allowed.

## Consequences

- An agent knows where code goes from what the code is.
- A lint rule reads the tier and the section from the import path alone.
- A private `repo/` means that no package reads the records of another
  package. The rule in
  [normalized source of truth](../../principles/normalized-source-of-truth.md)
  becomes a lint error.
- Each package is a deep module. A section that only passes calls through
  fails the deletion test, so a package does not add one.
- More Nx projects exist. Generators make them.
- The import policy, `check-manifests`, the alias table and the layout in
  [architecture](../architecture/index.md) change when this record is built.

Two questions stay open: whether each feature is its own Nx project, and
whether the service and domain kinds become one kind.

**Revisit if:** agents put more than one change in ten outside the folder that
this layout names for it.
