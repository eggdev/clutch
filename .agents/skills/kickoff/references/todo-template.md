# TODO.md format

Kickoff writes `TODO.md` at the repository root. The `build` skill works
through it and deletes it when every item is done.

```md
# Build plan

Branch: `build/<project>`. Work through the items in order. Check off an item
in the same commit that completes it. Add an item when you find a gap.

## Questions for the owner

None yet.

## 1. Scaffold

- [ ] Add `apps/web` with <framework>. Done when `validate` passes and
      `mise exec -- bun nx run web:dev` serves the home route.
- [ ] Add `packages/identity` (service, wraps <vendor>). Add the vendor to
      `tools/lint/boundaries.json`. Done when its tests pass.

## 2. Journey: <name from project intent>

- [ ] <one commit>. Done when <the test or check that proves it>.
- [ ] Add the end-to-end journey test for invariant <n>.
```

Rules:

- One item is one commit.
- Each item ends with "Done when" and a check that a machine can run.
- A journey is complete only with its end-to-end test.
- A question for the owner names the item it blocks and gives a
  recommendation.
