# Contributing

This is the documentation for people and agents who develop this project. Open
the page that owns your task. Do not read this folder from top to bottom.

## Start here

- [Project intent](./project-intent.md): users, goals, hard invariants and
  what not to assume. Read it before a product decision.
- [Engineering principles](../principles/index.md)
- [Glossary](./glossary.md): one meaning for each term. Use these words in
  code, docs and PRs.
- [Decision records](./decisions/index.md): the decisions already made. Read
  them before you propose a new primitive, surface or storage home.
- [Root README](../../README.md): set up and run the project from a fresh clone

The docs decide how this project works. Follow the page that owns a topic,
even when you know another way. To change a rule, change its page in the same
PR. Ask the owner first when the page is project intent, a principle or a
decision record.

## Tasks

Each task lists the pages and generators to open, in order. The rules live
on those pages; this list only points at them.

**Add a feature**

1. [Project intent](./project-intent.md): what the feature is for.
2. [Architecture](./architecture/index.md#package-sections): the tiers.
3. [Generators](./setup/nx.md#generators): the `feature` generator.
4. [One gate into each feature](../principles/one-gate-per-feature.md).
5. [Client](./architecture/client.md): how a screen reads and writes.

**Add a model or command**

1. [Local-first sync](./architecture/local-first-sync.md): records, groups
   and commands.
2. [Generators](./setup/nx.md#generators): the `model` and `command`
   generators.
3. [One door for each write](./architecture/authorization.md#one-door-for-each-write).
4. [Migrations](./setup/migrations.md), when the record has a table.

**Add a vendor**

1. [Generic platform](../principles/generic-platform.md): one owner package.
2. [Import boundaries](./import-boundaries.md): the registry entry.
3. [Server](./architecture/server.md#services-and-layers): the service and its
   Layers.
4. [Jobs and the outbox](./architecture/server.md#jobs-and-the-outbox): where
   a vendor call runs.

**Show server-computed or third-party data**

1. [Server data on a screen](./architecture/local-first-sync.md#server-data-on-a-screen).
2. [Jobs and the outbox](./architecture/server.md#jobs-and-the-outbox).

**Add a job or a webhook**

1. [Jobs and the outbox](./architecture/server.md#jobs-and-the-outbox).
2. [System writes, routes and webhooks](./architecture/server.md#system-writes-routes-and-webhooks).
3. [Generators](./setup/nx.md#generators): the `job` generator.

**Add a migration**

1. [Migrations](./setup/migrations.md): only drizzle-kit writes one.
2. [Two-way and one-way doors](../principles/two-way-doors.md).

## Setup and workflow

- [Agent workflow](./agent-workflow.md): lifecycle phases, exit conditions and
  readiness for bounded, parallel and triggered work
- [Delivery](./delivery.md): carry a feature, fix or refactor through review,
  verification and its authorized destination; resume from its task record
- [Setup](./setup/index.md): local services, configuration, checks
- [Harness engineering](./harness-engineering.md): the agent-first loop, agent hooks, how to
  turn a repeated lesson into a check, and PR review
- [Testing](./testing.md) and [end-to-end testing](./end-to-end-testing.md):
  journeys first, which test type to write, console output
- [Journeys](./setup/verification.md#journeys): add a journey, run it, and
  register it as a verify flow
- [Security](./security.md): the rules each change keeps, and the risks
  accepted on purpose
- [Operations](./operations/index.md): rollback, secret rotation, operator
  accounts and the runbook shape

## Architecture

- [Architecture](./architecture/index.md): tiers, package sections, the runtime
  map and one page for each system
- [Server](./architecture/server.md) and [client](./architecture/client.md):
  how Effect code and React code are written

<!-- kickoff: The three to five architecture pages that agents open most, one line each with when to open it. -->

## Code and tooling

- [Import boundaries](./import-boundaries.md): tiers, sections, server code,
  vendor owners, aliases, re-exports and test imports, with the lint rule for
  each
- [Nx](./setup/nx.md) and [checks](./setup/checks.md)

<!-- kickoff: A list of module READMEs, one link each. Write it when the first module exists. Delete this slot if kickoff ends before that. -->

## Writing docs

- [User docs](../users/README.md): page types and frontmatter for docs that
  users and their agents read
- [Documentation principles](./documentation.md): present tense, no status,
  one home for each fact, checks over should-lists
- [Documentation maintenance](./setup/documentation-maintenance.md)
