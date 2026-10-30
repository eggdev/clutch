# <!-- kickoff: product name --> agent index

<!-- kickoff: One sentence: what the product is and who it is for. -->

`mise exec -- bun run validate` runs every check. Run it before you say a change is done.

This file is a map, not the docs. Open the page that owns the task:

- Not defined yet: read [KICKOFF.md](./KICKOFF.md) first. In the template repository, work on the starter and tooling is allowed. In a project, run kickoff first, and ask the owner before product work while `KICKOFF.md` exists.
- Project intent: [docs/contributing/project-intent.md](./docs/contributing/project-intent.md)
- Contributor documentation map:
  [docs/contributing/index.md](./docs/contributing/index.md)
- Engineering principles: [docs/principles/](./docs/principles/index.md)
- Terms: [docs/contributing/glossary.md](./docs/contributing/glossary.md)
- Task skills: [`.agents/skills/`](./.agents/skills/). Repeatable commands by stage: [commands](./.agents/skills/deliver/references/commands.md)
- Tasks in this repository: [`.clutch/issues/`](./.clutch/README.md). `mise exec -- bun run clutch issues next` names the next one.
- Architecture: [docs/contributing/architecture/](./docs/contributing/architecture/index.md)
- Setup and checks: [docs/contributing/setup/](./docs/contributing/setup/index.md)
