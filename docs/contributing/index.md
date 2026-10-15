# Contributing

This is the documentation for people and agents who develop this project. Open
the page that owns your task. Do not read this folder from top to bottom.

## Start here

- [Project intent](./project-intent.md): users, goals, hard invariants and
  what not to assume. Read it before a product decision.
- [Engineering principles](../principles/index.md)
- [Decision records](./decisions/index.md): the nos already decided. Read them
  before you propose a new primitive, surface or storage home.
- [Root README](../../README.md): set up and run the project from a fresh clone

## Setup and workflow

- [Setup](./setup/index.md): local services, configuration, checks
- [Harness engineering](./harness-engineering.md): the agent-first loop, how to
  turn a repeated lesson into a check, and PR review

## Architecture

- [Architecture](./architecture/index.md): runtime map, module ownership and one
  page for each system

<!-- kickoff: The three to five architecture pages that agents open most, one line each with when to open it. -->

## Code and tooling

- [Import boundaries](./import-boundaries.md): services and domains, vendor
  owners, aliases and test imports, with the lint rule for each
- [Nx](./setup/nx.md) and [checks](./setup/checks.md)

<!-- kickoff: A list of module READMEs, one link each. Write it when the first module exists. Delete this slot if kickoff ends before that. -->

## Writing docs

- [Documentation principles](./documentation.md): present tense, no status,
  one home for each fact, checks over should-lists
- [Documentation maintenance](./setup/documentation-maintenance.md)
