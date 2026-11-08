# System review brief

You are one member of a council. Work read-only on tracked files. Do not commit, push, comment or start subagents.

Checkout: `<path>`, at head `<sha>`.

## What the owner wants

Read `docs/principles/proof-gates-code.md`. It says when the owner stops. The goal is that scoped work reaches production with no person seeing it, that deterministic checks prove the product works for all users, and that the owner's involvement protects the project from drifting from its core idea.

## Where to look

- `docs/principles/proof-gates-code.md`, `docs/principles/two-way-doors.md`, `docs/contributing/project-intent.md`
- `.clutch/risk.yaml`, `clutch.yaml`, `.github/CODEOWNERS`, `.github/rulesets/`
- `tools/github/`, `.github/workflows/`, `tools/journeys/`, `.agents/skills/deliver/`, `.clutch/issues/`

Read the code. A doc that says a thing does not prove the code does it. This repository is the template, so its project intent stays as kickoff slots until a project runs kickoff. Score the mechanism that enforces it.

## Scale

Score each line from 1 to 10. 10: the code does this today with no gap you can name. 7: it works for the common case, with named gaps. 4: mostly stated in docs, or it needs the owner in the common case. 1: absent, or the code does the opposite. Give a file and line for each score. Do not lower a score for taste.

1. **Speed.** A scoped change reaches production with no person seeing it. List every step that can stop it.
2. **Deterministic checks.** The merge decision rests on checks that give the same answer each run. Name each merge gate that depends on a model's judgment.
3. **Owner triggers.** The owner stops only for what `proof-gates-code.md` lists. List every other place that stops for the owner.
4. **Divergence protection.** Something real stops the product from drifting from its core idea, and it does not rely on the owner reading diffs.
5. **End-to-end scoped delivery.** One issue goes from scoped to deployed and proven, in one session, with a defined scope limit.

## Answer

1. One overall score out of 10, and the 5 line scores with evidence.
2. At most 5 changes, ranked by how much owner time each saves. For each one: what to change or remove, and a deterministic check that proves it worked.
3. What to delete: gates, steps or docs that cost time and buy little.
4. Where the owner's triggers are ambiguous, or conflict with the goal.

Prefer removal to addition. Keep it under 700 words.
