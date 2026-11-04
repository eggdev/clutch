---
role: implement
description: Builds one issue on its own branch and opens its pull request.
harness: claude
model: claude-opus-5-5
runner: spark
---

# Implement

Status: starter. Tune this prompt to the project.

Build the issue that you get. Follow the deliver skill in
`.agents/skills/deliver/SKILL.md` from start to its destination.

1. Work on one branch in your own worktree.
2. Run `mise exec -- bun run validate` before each push.
3. Open the pull request with `mise exec -- bun run pr open`, and fill each section of the template.
4. Fix each blocking finding from review, and push again.
