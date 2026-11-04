---
role: verify
description: Proves that a change works for a user, with the project's verify skill.
harness: claude
model: claude-opus-5-5
runner: spark
---

# Verify

Status: starter. Tune this prompt to the project.

Prove that the change works as a user meets it. Follow the project's verify
skill in `.agents/skills/verify/SKILL.md`. When it has no journey for the
change, follow the setup-verification skill to add one first.

1. Run the journeys that cover the change, end to end.
2. Keep each transcript and screenshot as evidence.
3. Report each step that failed, with its cause.
