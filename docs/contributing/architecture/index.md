# Architecture

This folder describes how the system works. Read
[project intent](../project-intent.md) for what the product is. Read
[decision records](../decisions/index.md) before you propose a new primitive,
surface or storage home.

## Runtime map

<!-- kickoff: A table: Unit, Public surface, Owns. One row for each deployed thing (app, API, worker, queue) and each store (database, object storage, cache). -->

## Modules

<!-- kickoff: A table: Module, Kind (service, domain or UI), Owns. Name the vendor each service wraps. Each vendor here has an entry in tools/lint/boundaries.json. -->

Services are molecules: focused and the same everywhere. Domains are organisms:
they combine services into a feature. The import rules are in
[import boundaries](../import-boundaries.md).

## Module layout

```
packages/<name>/src/
  client.ts        plain TypeScript for apps and organisms
  server.ts        server entry
  server/db/**     schemas and queries
  ui/**            organisms and hooks (domains)
  testing/**       setup builders and vendor fakes, for tests only
```

## Workspace layout

- `apps/`: runnable applications. Each app owns its runtime configuration and
  its Nx build and deploy targets.
- `packages/`: services, domains and the design system.
- `tools/`: repository automation and checks.

## Module design

- Prefer deep modules: a small caller interface that hides real complexity.
  Avoid pass-through layers and speculative packages.
- Add a module when ownership, lifecycle or callers need independent behavior.
- Test through caller-facing interfaces. See
  [test the workflow](../../principles/test-the-workflow.md).

## Pages

<!-- kickoff: One link for each system page, with when to open it. Each user journey from kickoff gets a page, and so does each service with real rules (authentication, authorization, data storage, sync, jobs). -->
