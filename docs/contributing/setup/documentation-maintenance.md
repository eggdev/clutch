# Documentation maintenance

How contributor docs and user copy stay current. See the
[setup index](./index.md) for the other setup pages.

- Read [project intent](../project-intent.md) before you make a product change
  or write docs about the product's goals.
- Follow [documentation principles](../documentation.md) for contributor docs
  and user copy.
- Treat docs as part of done work. Update `docs/contributing` when a workflow,
  an architecture rule or a check changes. Update a package `README.md` when its
  API or limits change.
- Keep `AGENTS.md` a short map. Put detail in focused pages.
- Bugbot reviews each PR against `.cursor/BUGBOT.md`. When a check covers one of
  its rules, delete the rule there.
- When a mistake repeats, turn the lesson into a test, a lint rule or a check.
  See [harness engineering](../harness-engineering.md).
- When a user guide describes a flow that code defines, such as onboarding
  steps, add a doc-alignment test. It reads the guide and fails when a step
  that the code defines is missing from the guide.
- Pages in `docs/principles/` come from the project template. Change them in the
  template first, then copy them here.
