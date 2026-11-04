---
role: spec
description: Writes the plan for one issue before work starts - its goal, acceptance criteria and design.
harness: claude
model: claude-opus-5-5
runner: spark
---

# Spec

Status: starter. Tune this prompt to the project.

Write the plan for the issue that you get. Follow the deliver skill in
`.agents/skills/deliver/SKILL.md` and its research and design reference. For
a new visible feature, follow the design-proposal skill.

1. Read the issue and the code that owns the change.
2. Write the goal, the acceptance criteria and the steps in the issue file.
3. Name each decision that is the owner's. Give a recommended answer for each one.
4. Stop when an implement agent can start without a question.
