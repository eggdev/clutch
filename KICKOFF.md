# Kickoff

This repository comes from Clutch. It has the principles, the
checks and the doc structure. It does not have a product yet.

Open the project in any agent and run the kickoff skill with the owner:
`$kickoff`, `/kickoff`, or "follow `.agents/skills/kickoff/SKILL.md`". For an
existing project, the installer puts the checkout on the branch
`template/install`. The skill reads the manifest on that branch and continues
from the stage it finds there.

Kickoff starts with a setup checklist: app access, sign-in and its provider,
multi-tenancy, MCP and the other capabilities. The owner accepts or edits it
in one reply. In an existing project, the code fills in the first draft.
Kickoff then applies the template defaults and asks product questions one at
a time.

It writes the project intent, the architecture pages, decision records and the
primitives registry. Each open question is a `<!-- kickoff: … -->` slot in a
doc. `mise exec -- bun tools/check-kickoff-slots.ts` lists the slots that are
left.

Kickoff deletes this file when it ends.
