---
description: Grades each implement run against the Acceptance criteria of its issue.
agents: [implement]
judge: qwen3.8-27b
labels:
  - value: complete
    score: 1
    description: Each acceptance criterion has evidence, and the pull request does no work that the issue does not ask for.
  - value: partial
    score: 0.5
    description: Some criteria have no evidence, or the pull request adds work that the issue does not ask for.
  - value: missed
    score: 0
    description: No criterion has evidence, or the pull request does other work.
  - value: no_criteria
    score: 0
    description: The pull request has no work item, or the work item has no Acceptance criteria section.
passingScore: 1
samplingRate: 25
---

Judge the pull request against the Acceptance criteria section of its work item. The work item is the `.clutch/issues` file at the head commit.

1. Read each acceptance criterion.
2. Find the evidence for each criterion in the diff. Some criteria name a result that a diff cannot show, such as a posted comment, a passing check or a measured number. For each of these, find the evidence in the description, such as a command and its result.
3. Find work in the diff that the work item does not ask for. A changeset, the issue file, the docs of the change and its tests are part of the work.

Pick `complete` only when each criterion has evidence. The reason names the first criterion that has no evidence, or it says that each criterion has evidence.
