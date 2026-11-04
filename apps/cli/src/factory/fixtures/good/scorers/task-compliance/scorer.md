---
description: Grades each implement run against its issue.
agents: [implement]
judge: qwen3.8-27b
labels:
  - value: complete
    score: 1
    description: The pull request does what the issue asks, and nothing more.
  - value: partial
    score: 0.5
    description: The pull request does part of what the issue asks.
  - value: off_task
    score: 0
    description: The pull request does not do what the issue asks.
passingScore: 1
samplingRate: 25
---

Compare the pull request with its issue. Return one label and one sentence that says why.
