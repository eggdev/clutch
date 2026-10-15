# Kickoff

This repository comes from the project template. It has the principles, the
checks and the doc structure. It does not have a product yet.

Do not build anything. Run the kickoff skill with the owner:

```sh
claude "/kickoff"
codex "\$kickoff"
```

Kickoff is one interview, one question at a time. It writes project intent,
the architecture pages, decision records, `tools/lint/boundaries.json` and a
`TODO.md` build plan. Each open question is a `<!-- kickoff: … -->` slot in a
doc. `mise exec -- bun tools/check-kickoff-slots.ts` lists the slots that are
left.

Kickoff deletes this file when it ends. Then the `build` skill works through
`TODO.md`.
