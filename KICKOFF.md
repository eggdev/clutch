# Kickoff

This repository comes from the project template. It has the principles, the
checks and the doc structure. It does not have a product yet.

Do not build anything. Run the kickoff skill with the owner:

```sh
claude "/kickoff"
codex "\$kickoff"
```

Kickoff starts with a setup checklist: app access, authentication and provider,
multi-tenancy, MCP and other capabilities. Accept or edit these choices
together, then discuss the product one question at a time. Routine engineering setup
uses template defaults automatically. Existing projects
start with choices inferred from their code. It writes project intent,
the architecture pages, decision records and the primitives registry. Each open question is a `<!-- kickoff: … -->` slot in a
doc. `mise exec -- bun tools/check-kickoff-slots.ts` lists the slots that are
left.

Kickoff deletes this file when it ends.
