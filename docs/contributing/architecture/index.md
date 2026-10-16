# Architecture

This folder describes how the system works. Read
[project intent](../project-intent.md) for what the product is. Read
[decision records](../decisions/index.md) before you propose a new primitive,
surface or storage home.

## Runtime map

<!-- kickoff: A table: Unit, Public surface, Owns, Binds. One row for each deployed thing (app, API, worker, queue) and each store (database, object storage, cache). Binds names the other units and stores that this unit calls. -->

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

## Source of truth in code

<!-- kickoff: One line for each entry point, router and composition root: the file and what it starts. -->

## Pages

- [Request context](./request-context.md): how a request becomes a tenant and
  an actor
- [Authorization](./authorization.md): the access check, and the permission
  each surface declares
- [Data storage](./data-storage.md): tenant isolation, the data inventory and
  frozen storage contracts
- [Feature flags](./feature-flags.md): the registry in code, the flag service,
  and when a flag goes away

<!-- kickoff: One link for each other system page, with when to open it. Each user journey from kickoff gets a page, and so does each service with real rules (authentication, sync, jobs). -->

## Page shape

Each page here follows one shape, so readers know where a fact lives:

1. A table that answers the page's core questions.
2. The rules, each one a sentence that a test or a check can prove.
3. A recipe for the common extension, such as a new entry point or a new
   store, when one exists.
4. "What to read when changing it": the files and pages to open first.

A runbook for a one-time operation lives in
[operations](../operations/index.md).
