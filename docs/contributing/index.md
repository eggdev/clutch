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

## Setup and workflow

- [Agent workflow](./agent-workflow.md): lifecycle phases, exit conditions and
  readiness for bounded, parallel and triggered work
- [Delivery](./delivery.md): carry a feature, fix or refactor through review,
  verification and its authorized destination; resume from its task record
- [Setup](./setup/index.md): local services, configuration, checks
- [Harness engineering](./harness-engineering.md): the agent-first loop, agent hooks, how to
  turn a repeated lesson into a check, and PR review
- [Testing](./testing.md) and [end-to-end testing](./end-to-end-testing.md):
  which test type to write, console output, journeys
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
